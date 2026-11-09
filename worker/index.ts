import { evaluateBestHand, createDeck, shuffle, type Card } from '../src/poker.js';

export interface Env { ROOMS: DurableObjectNamespace; ASSETS: Fetcher; }
type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
type GameState = 'lobby' | 'playing' | 'result' | 'ended';
const PHASES: Phase[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const PHASE_NAMES: Record<Phase, string> = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '结算' };
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Player = { id:string; sessionId:string; name:string; connected:boolean; hand:Card[]; currentChip:number|null; chipHistory:Record<string, number|null>; phaseActionCount:number; totalActionCount:number; stealsMade:number; timesStolen:number; selectedAt?:number; lastActionAt?:number };
type ChipAction = { actionId:string; timestamp:number; phase:Phase; actorId:string; actorName:string; chipValue:number; sourceType:'center'|'player'; sourcePlayerId?:string; sourcePlayerName?:string; previousChip:number|null; affectedPlayerId?:string; affectedPlayerName?:string; actionType:'take'|'steal'|'return'|'replace'; actorCounts:{phase:number;total:number;stealsMade:number}; affectedCounts?:{phase:number;total:number;timesStolen:number} };
type ResultPlayer = { playerId:string; name:string; hand:Card[]; result:ReturnType<typeof evaluateBestHand>; finalChip:number|null; targetChip:number; order:number };
type OrderSlot = { chipValue:number; target:ResultPlayer; actual?:ResultPlayer; correct:boolean; explanation:string };
type Result = { heistNumber:number; success:boolean; alarms:number; vaults:number; players:ResultPlayer[]; resolvedAt:number; reason:string; orderComparison:OrderSlot[] };
type Room = { code:string; hostId:string; gameState:GameState; phase:Phase; heistNumber:number; alarms:number; vaults:number; communityCards:Card[]; deck:Card[]; availableChips:number[]; players:Record<string,Player>; eventLog:ChipAction[]; version:number; result?:Result; createdAt:number };
type WireMessage = { event:string; payload?:any; requestId?:string };

function cleanName(raw:unknown) { const name=String(raw ?? '').trim().replace(/[<>]/g,'').replace(/\s+/g,' '); if (!name) throw new Error('请先输入昵称'); return name.slice(0,16); }
function cleanSession(raw:unknown) { const value=String(raw ?? '').trim(); if (!value || value.length>128) throw new Error('会话标识无效，请刷新页面重试'); return value; }
function playerList(room:Room) { return Object.values(room.players); }
function publicRoom(room:Room, viewerId?:string) { return { ...room, players:playerList(room).map((p)=>({ ...p, hand:p.id===viewerId || room.gameState==='result' || room.gameState==='ended' ? p.hand : undefined })), reconnectSeconds:90, viewerId }; }
function scoreValue(score:number[]) { return score.reduce((total, value, index)=>total + value * Math.pow(15, 8-index),0); }
function orderComparison(players:ResultPlayer[]):OrderSlot[] { const targets=[...players].sort((a,b)=>a.targetChip-b.targetChip); const actual=[...players].sort((a,b)=>(a.finalChip ?? 999)-(b.finalChip ?? 999)); return targets.map((target,index)=>{const seen=actual[index]; const correct=seen?.playerId===target.playerId && seen?.finalChip===target.targetChip; return { chipValue:target.targetChip,target,actual:seen,correct,explanation:correct?`${target.name} 的牌力与 ${target.targetChip} 星筹码相符。`:`${target.name} 应拿 ${target.targetChip} 星筹码；实际该位置是 ${seen?`${seen.name} 的 ${seen.finalChip} 星筹码`:'未选择筹码'}。`}; }); }

export class RoomCoordinator implements DurableObject {
  private room?:Room; private loading?:Promise<void>;
  constructor(private readonly ctx:DurableObjectState, private readonly env:Env) {}
  private async load() { if (!this.loading) this.loading=this.ctx.blockConcurrencyWhile(async()=>{ this.room=await this.ctx.storage.get<Room>('room'); }); await this.loading; }
  private async save() { if (this.room) await this.ctx.storage.put('room',this.room); }
  private reply(ws:WebSocket,event:string,payload:any,requestId?:string) { ws.send(JSON.stringify(requestId?{event:'ack',requestId,payload}:{event,payload})); }
  private async broadcast(event:string,payload:any) { for (const ws of this.ctx.getWebSockets()) this.reply(ws,event,payload); }
  private async states() { if (!this.room) return; for (const ws of this.ctx.getWebSockets()) { const info=ws.deserializeAttachment() as {playerId?:string}|null; this.reply(ws,'room:state',publicRoom(this.room,info?.playerId)); } }
  private findPlayer(sessionId:string) { if (!this.room) return; return playerList(this.room).find((p)=>p.sessionId===sessionId); }
  private ensureHost(payload:any) {
    const name=cleanName(payload?.name); const sessionId=cleanSession(payload?.sessionId); const id=crypto.randomUUID();
    const host:Player={id,sessionId,name,connected:false,hand:[],currentChip:null,chipHistory:{},phaseActionCount:0,totalActionCount:0,stealsMade:0,timesStolen:0};
    return { host, sessionId };
  }
  async fetch(request:Request) {
    await this.load(); const url=new URL(request.url);
    if (request.method==='POST' && url.pathname==='/create') {
      if (this.room) return Response.json({ok:false,message:'这个房间码已存在'}, {status:409});
      try { const payload=await request.json() as Record<string, unknown>; const {host}=this.ensureHost(payload); this.room={code:String(payload.code),hostId:host.id,gameState:'lobby',phase:'preflop',heistNumber:1,alarms:0,vaults:0,communityCards:[],deck:[],availableChips:[],players:{[host.id]:host},eventLog:[],version:1,createdAt:Date.now()}; await this.save(); return Response.json({ok:true,code:this.room.code}); } catch(error) { return Response.json({ok:false,message:error instanceof Error?error.message:'创建房间失败'},{status:400}); }
    }
    if (request.headers.get('Upgrade')!=='websocket') return new Response('需要 WebSocket 连接',{status:426});
    const pair=new WebSocketPair(); const [client,server]=Object.values(pair) as [WebSocket,WebSocket]; this.ctx.acceptWebSocket(server); return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer) {
    try { const data=JSON.parse(typeof message==='string'?message:new TextDecoder().decode(message)) as WireMessage; await this.handle(ws,data); } catch(error) { this.reply(ws,'room:error',{message:error instanceof Error?error.message:'请求格式无效'}); }
  }
  async webSocketClose(ws:WebSocket) { await this.load(); if (!this.room) return; const info=ws.deserializeAttachment() as {playerId?:string}|null; const player=info?.playerId?this.room.players[info.playerId]:undefined; if (player) { player.connected=false; this.room.version+=1; await this.save(); await this.broadcast('room:player-left',{playerId:player.id,name:player.name,temporary:true}); await this.states(); } }
  private async handle(ws:WebSocket, data:WireMessage) {
    await this.load(); const ack=(payload:any)=>this.reply(ws,'ack',payload,data.requestId);
    if (!this.room) { ack({ok:false,message:'房间不存在或已解散'}); return; }
    try {
      if (data.event==='room:join') return await this.join(ws,data.payload,ack);
      const attachment=ws.deserializeAttachment() as {playerId?:string}|null; const player=attachment?.playerId?this.room.players[attachment.playerId]:undefined;
      if (!player) throw new Error('请先加入房间');
      if (data.event==='game:start') { this.onlyHost(player); this.start(); ack({ok:true}); await this.broadcast('game:phase',{phase:this.room.phase,phaseName:PHASE_NAMES[this.room.phase]}); await this.save(); await this.states(); return; }
      if (data.event==='chip:choose') { const action=this.choose(player,Number(data.payload?.value),data.payload?.sourcePlayerId); ack({ok:true,actionId:action.actionId}); await this.broadcast('chip:event',action); await this.broadcast('chip:action',action); await this.broadcast(action.actionType==='steal'?'chip:stolen':action.actionType==='replace'?'chip:returned':'chip:action',action); await this.save(); await this.states(); return; }
      if (data.event==='phase:next') { this.onlyHost(player); if (this.room.phase==='river') this.settle(); else this.nextPhase(); ack({ok:true}); await this.broadcast('game:phase',{phase:this.room.phase,phaseName:PHASE_NAMES[this.room.phase]}); if (this.room.result) await this.broadcast('game:result',this.room.result); await this.save(); await this.states(); return; }
      if (data.event==='heist:next') { this.onlyHost(player); this.nextHeist(); ack({ok:true}); await this.broadcast('game:phase',{phase:this.room.phase,phaseName:PHASE_NAMES[this.room.phase]}); await this.save(); await this.states(); return; }
      if (data.event==='player:kick') { this.onlyHost(player); const target=this.room.players[String(data.payload?.playerId)]; if (!target||target.id===player.id) throw new Error('无法移除这位玩家'); delete this.room.players[target.id]; this.room.version+=1; ack({ok:true}); await this.broadcast('room:player-left',{playerId:target.id,name:target.name}); await this.save(); await this.states(); return; }
      if (data.event==='room:leave') { delete this.room.players[player.id]; this.room.version+=1; ack({ok:true}); this.reply(ws,'room:left',{}); await this.save(); await this.broadcast('room:player-left',{playerId:player.id,name:player.name}); await this.states(); return; }
      throw new Error('不支持的操作');
    } catch(error) { const message=error instanceof Error?error.message:'操作失败，请重试'; this.reply(ws,'room:error',{message}); ack({ok:false,message}); }
  }
  private async join(ws:WebSocket,payload:any,ack:(body:any)=>void) {
    const sessionId=cleanSession(payload?.sessionId); let player=this.findPlayer(sessionId); let joined=false;
    if (player) { player.connected=true; player.name=cleanName(payload?.name||player.name); }
    else { if (this.room!.gameState!=='lobby') throw new Error('对局进行中，暂不能中途加入'); if (playerList(this.room!).length>=6) throw new Error('房间已满（最多 6 人）'); const name=cleanName(payload?.name); if(playerList(this.room!).some((p)=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase())) throw new Error('昵称已被使用，请换一个昵称'); player={id:crypto.randomUUID(),sessionId,name,connected:true,hand:[],currentChip:null,chipHistory:{},phaseActionCount:0,totalActionCount:0,stealsMade:0,timesStolen:0}; this.room!.players[player.id]=player; joined=true; }
    ws.serializeAttachment({playerId:player.id}); this.room!.version+=1; ack({ok:true,code:this.room!.code,reconnected:!joined}); await this.save(); if(joined) await this.broadcast('room:player-joined',{playerId:player.id,name:player.name}); await this.states();
  }
  private onlyHost(player:Player) { if (this.room!.hostId!==player.id) throw new Error('只有房主可以进行这项操作'); }
  private newRound() { const room=this.room!; room.phase='preflop';room.communityCards=[];room.eventLog=[];room.result=undefined;room.deck=shuffle(createDeck());room.availableChips=playerList(room).map((_,i)=>i+1);for(const p of playerList(room)){p.hand=[room.deck.pop()!,room.deck.pop()!];p.currentChip=null;p.chipHistory={};p.phaseActionCount=0;p.selectedAt=undefined;}room.version+=1; }
  private start() { const room=this.room!; const count=playerList(room).length;if(count<3||count>6)throw new Error('需要 3–6 位正式玩家才能开始');room.gameState='playing';this.newRound(); }
  private choose(actor:Player,value:number,sourceId?:string) { const room=this.room!; if(room.gameState!=='playing'||room.phase==='showdown')throw new Error('当前不在抢筹阶段');if(!Number.isInteger(value)||value<1||value>playerList(room).length)throw new Error('筹码星级无效');if(sourceId===actor.id)throw new Error('不能抢自己的筹码');const source=sourceId?room.players[sourceId]:undefined;if(sourceId&&(!source||source.currentChip!==value))throw new Error('目标玩家当前没有这枚筹码');if(!sourceId&&!room.availableChips.includes(value))throw new Error('这枚筹码已被拿走');const previousChip=actor.currentChip;if(previousChip!==null)room.availableChips.push(previousChip);if(source){source.currentChip=null;source.phaseActionCount=0;source.timesStolen+=1;source.lastActionAt=Date.now();}else room.availableChips=room.availableChips.filter((chip)=>chip!==value);actor.currentChip=value;actor.phaseActionCount+=1;actor.totalActionCount+=1;actor.lastActionAt=Date.now();actor.selectedAt=Date.now();actor.chipHistory[room.phase]=value;if(source)actor.stealsMade+=1;const action:ChipAction={actionId:crypto.randomUUID(),timestamp:Date.now(),phase:room.phase,actorId:actor.id,actorName:actor.name,chipValue:value,sourceType:source?'player':'center',sourcePlayerId:source?.id,sourcePlayerName:source?.name,previousChip,affectedPlayerId:source?.id,affectedPlayerName:source?.name,actionType:source?'steal':previousChip===null?'take':'replace',actorCounts:{phase:actor.phaseActionCount,total:actor.totalActionCount,stealsMade:actor.stealsMade},affectedCounts:source?{phase:source.phaseActionCount,total:source.totalActionCount,timesStolen:source.timesStolen}:undefined};room.eventLog.push(action);room.availableChips=[...new Set(room.availableChips)].sort((a,b)=>a-b);room.version+=1;return action; }
  private nextPhase() { const room=this.room!;if(playerList(room).some((p)=>p.currentChip===null))throw new Error('还有玩家没有选择筹码');const next=PHASES[PHASES.indexOf(room.phase)+1];if(!next||next==='showdown')throw new Error('当前阶段已经结算');room.phase=next;if(next==='flop')room.communityCards=[room.deck.pop()!,room.deck.pop()!,room.deck.pop()!];if(next==='turn'||next==='river')room.communityCards.push(room.deck.pop()!);for(const p of playerList(room)){p.currentChip=null;p.phaseActionCount=0;p.selectedAt=undefined;}room.availableChips=playerList(room).map((_,i)=>i+1);room.version+=1; }
  private settle() { const room=this.room!;if(room.phase!=='river')throw new Error('还没有到结算阶段');if(playerList(room).some((p)=>p.currentChip===null))throw new Error('还有玩家没有选择筹码');room.phase='showdown';const players:ResultPlayer[]=playerList(room).map((p)=>({playerId:p.id,name:p.name,hand:p.hand,result:evaluateBestHand([...p.hand,...room.communityCards]),finalChip:p.currentChip,targetChip:0,order:0}));players.sort((a,b)=>scoreValue(b.result.score)-scoreValue(a.result.score));players.forEach((p,index)=>{p.order=index+1;p.targetChip=players.length-index;});const success=players.every((p)=>p.finalChip===p.targetChip);if(success)room.vaults+=1;else room.alarms+=1;room.result={heistNumber:room.heistNumber,success,alarms:room.alarms,vaults:room.vaults,players,resolvedAt:Date.now(),reason:success?'筹码顺序与牌力从弱到强一致，保险箱已打开。':'筹码顺序与牌力不一致，警报被触发。',orderComparison:orderComparison(players)};room.gameState='result';room.version+=1; }
  private nextHeist() { const room=this.room!;if(room.gameState!=='result')throw new Error('当前还不能开始下一劫案');if(room.alarms>=3||room.vaults>=3){room.gameState='ended';room.version+=1;return;}room.heistNumber+=1;room.gameState='playing';this.newRound(); }
}

function newCode() { let code='';for(let i=0;i<6;i+=1)code+=ROOM_ALPHABET[Math.floor(Math.random()*ROOM_ALPHABET.length)];return code; }
export default { async fetch(request:Request, env:Env):Promise<Response> { const url=new URL(request.url); if(request.method==='POST'&&url.pathname==='/api/rooms'){const payload=await request.json() as Record<string, unknown>;for(let i=0;i<5;i+=1){const code=newCode();const stub=env.ROOMS.get(env.ROOMS.idFromName(code));const response=await stub.fetch('https://room/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,code})});if(response.ok)return response;}return Response.json({ok:false,message:'房间码分配失败，请重试'},{status:503});} if(url.pathname.startsWith('/ws/')){const code=url.pathname.split('/').pop()?.toUpperCase();if(!code||!/^[A-Z0-9]{6}$/.test(code))return new Response('房间码无效',{status:400});return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);} return env.ASSETS.fetch(request); } } satisfies ExportedHandler<Env>;
