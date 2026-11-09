import { randomUUID } from 'node:crypto';
import { createDeck, evaluateBestHand, shuffle } from './poker.js';
import type { Card } from './poker.js';
import { PHASES, PHASE_NAMES } from './types.js';
import type { ChipAction, GameResult, Phase, Player, PlayerView, RoomStateView } from './types.js';

export type Room = {
  code: string; hostId: string; gameState: RoomStateView['gameState']; phase: Phase; heistNumber: number;
  alarms: number; vaults: number; communityCards: Card[]; deck: Card[]; availableChips: number[];
  players: Map<string, Player>; eventLog: ChipAction[]; version: number; result?: GameResult;
  createdAt: number; disconnectedAt: Map<string, number>;
};

export function makeRoom(code: string, host: Player): Room {
  return { code, hostId: host.id, gameState: 'lobby', phase: 'preflop', heistNumber: 1, alarms: 0, vaults: 0, communityCards: [], deck: [], availableChips: [], players: new Map([[host.id, host]]), eventLog: [], version: 1, createdAt: Date.now(), disconnectedAt: new Map() };
}

export function makePlayer(name: string, sessionId: string, socketId: string): Player {
  return { id: randomUUID(), sessionId, name, connected: true, socketId, hand: [], currentChip: null, chipHistory: {}, phaseActionCount: 0, totalActionCount: 0, stealsMade: 0, timesStolen: 0 };
}

export function publicState(room: Room, viewerId?: string): RoomStateView {
  return {
    code: room.code, hostId: room.hostId, gameState: room.gameState, phase: room.phase, heistNumber: room.heistNumber,
    alarms: room.alarms, vaults: room.vaults, communityCards: room.communityCards, availableChips: [...room.availableChips].sort((a,b)=>a-b),
    players: [...room.players.values()].map((p): PlayerView => ({ ...p, hand: p.id === viewerId ? p.hand : undefined })),
    eventLog: room.eventLog.slice(-120), version: room.version, result: room.result, reconnectSeconds: 90,
    viewerId: viewerId && room.players.has(viewerId) ? viewerId : undefined,
  };
}

function clearRound(room: Room) {
  room.phase = 'preflop'; room.communityCards = []; room.eventLog = []; room.result = undefined;
  room.deck = shuffle(createDeck()); room.availableChips = [...room.players.values()].map((_, i) => i + 1);
  for (const player of room.players.values()) {
    player.hand = [room.deck.pop()!, room.deck.pop()!]; player.currentChip = null; player.phaseActionCount = 0; player.selectedAt = undefined; player.chipHistory = {};
  }
  room.version += 1;
}

export function startGame(room: Room): void {
  if (room.players.size < 3 || room.players.size > 6) throw new Error('需要 3–6 位正式玩家才能开始');
  room.gameState = 'playing'; room.heistNumber = Math.max(room.heistNumber, 1); room.alarms = room.alarms; room.vaults = room.vaults;
  clearRound(room);
}

export function startNextHeist(room: Room): void {
  if (room.gameState !== 'result') throw new Error('当前还不能开始下一劫案');
  if (room.alarms >= 3 || room.vaults >= 3) { room.gameState = 'ended'; room.version += 1; return; }
  room.heistNumber += 1; room.gameState = 'playing'; clearRound(room);
}

export function revealNextPhase(room: Room): Phase {
  const index = PHASES.indexOf(room.phase);
  if (index < 0 || index >= 4) throw new Error('当前阶段已经结算');
  if ([...room.players.values()].some((p) => p.currentChip === null)) throw new Error('还有玩家没有选择筹码');
  const next = PHASES[index + 1]; room.phase = next;
  if (next === 'flop') room.communityCards = [room.deck.pop()!, room.deck.pop()!, room.deck.pop()!];
  if (next === 'turn' || next === 'river') room.communityCards = [...room.communityCards, room.deck.pop()!];
  for (const p of room.players.values()) { p.chipHistory[next] = null; p.phaseActionCount = 0; p.currentChip = null; p.selectedAt = undefined; }
  room.availableChips = [...room.players.values()].map((_, i) => i + 1); room.version += 1;
  return next;
}

export function chooseChip(room: Room, actorId: string, value: number, sourcePlayerId?: string): { action: ChipAction; affected?: Player } {
  if (room.gameState !== 'playing' || room.phase === 'showdown') throw new Error('当前不在抢筹阶段');
  const actor = room.players.get(actorId); if (!actor) throw new Error('玩家不存在');
  const playerCount = room.players.size;
  if (!Number.isInteger(value) || value < 1 || value > playerCount) throw new Error('筹码星级无效');
  if (sourcePlayerId === actorId) throw new Error('不能抢自己的筹码');
  const sourceType = sourcePlayerId ? 'player' : 'center';
  const source = sourcePlayerId ? room.players.get(sourcePlayerId) : undefined;
  if (sourcePlayerId && (!source || source.currentChip === null || source.currentChip !== value)) throw new Error('目标玩家当前没有这枚筹码');
  if (!sourcePlayerId && !room.availableChips.includes(value)) throw new Error('这枚筹码已被拿走');
  const previousChip = actor.currentChip;
  if (previousChip !== null) room.availableChips.push(previousChip);
  if (source) { source.currentChip = null; source.phaseActionCount = 0; source.timesStolen += 1; source.lastActionAt = Date.now(); }
  else room.availableChips = room.availableChips.filter((chip) => chip !== value);
  actor.currentChip = value; actor.phaseActionCount += 1; actor.totalActionCount += 1; actor.lastActionAt = Date.now(); actor.selectedAt = Date.now();
  if (source) actor.stealsMade += 1;
  actor.chipHistory[room.phase] = value;
  const action: ChipAction = {
    actionId: randomUUID(), timestamp: Date.now(), phase: room.phase, actorId, actorName: actor.name, chipValue: value,
    sourceType, sourcePlayerId: source?.id, sourcePlayerName: source?.name, previousChip, affectedPlayerId: source?.id, affectedPlayerName: source?.name,
    actionType: source ? 'steal' : previousChip === null ? 'take' : 'replace',
    actorCounts: { phase: actor.phaseActionCount, total: actor.totalActionCount, stealsMade: actor.stealsMade },
    affectedCounts: source ? { phase: source.phaseActionCount, total: source.totalActionCount, timesStolen: source.timesStolen } : undefined,
  };
  room.eventLog.push(action); room.availableChips = [...new Set(room.availableChips)].sort((a,b)=>a-b); room.version += 1;
  return { action, affected: source };
}

export function settle(room: Room): GameResult {
  if (room.gameState !== 'playing' || room.phase !== 'river') throw new Error('还没有到结算阶段');
  room.phase = 'showdown';
  const players = [...room.players.values()].map((p) => ({ playerId: p.id, name: p.name, hand: p.hand, result: evaluateBestHand([...p.hand, ...room.communityCards]), finalChip: p.currentChip, order: 0 }));
  players.sort((a,b) => b.result.score.reduce((n,v,i)=>n + v * Math.pow(15, 8-i), 0) - a.result.score.reduce((n,v,i)=>n + v * Math.pow(15, 8-i), 0));
  players.forEach((p, i) => { p.order = i + 1; });
  const chips = players.map((p) => p.finalChip ?? 0); const expected = [...chips].sort((a,b)=>b-a);
  const success = chips.every((chip, i) => chip === expected[i]);
  if (success) room.vaults += 1; else room.alarms += 1;
  const result: GameResult = { heistNumber: room.heistNumber, success, alarms: room.alarms, vaults: room.vaults, players, resolvedAt: Date.now(), reason: success ? '筹码顺序与牌力从弱到强一致，保险箱已打开。' : '筹码顺序与牌力不一致，警报被触发。' };
  room.result = result; room.gameState = 'result'; room.version += 1; return result;
}
