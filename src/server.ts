import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  makePlayer, makeRoom, publicState, startGame, startNextHeist,
  revealNextPhase, chooseChip, settle, type Room,
} from './game.js';
import { PHASE_NAMES } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
// 云端平台会通过 PORT 转发公网请求，必须监听所有网卡。
const HOST = process.env.HOST ?? '0.0.0.0';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>(); // socket.id -> room code

export const app = express();
const webRoot = path.resolve(__dirname, '..');
app.use(express.static(webRoot, { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

export const httpServer = http.createServer(app);
export const io = new Server(httpServer, { cors: { origin: true } });

function makeRoomCode(): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('房间码分配失败');
}

function sanitizeName(raw: unknown): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('请先输入昵称');
  return name.slice(0, 16);
}

function sanitizeSession(raw: unknown): string {
  const session = String(raw ?? '').trim();
  if (!session || session.length > 64) throw new Error('会话标识无效，请刷新页面重试');
  return session;
}

function getRoom(code: unknown): Room {
  const key = String(code ?? '').trim().toUpperCase();
  const room = rooms.get(key);
  if (!room) throw new Error('房间不存在或已解散，请确认房间码');
  return room;
}

function bindSocket(socket: Socket, room: Room, playerId: string, sessionId: string): void {
  socket.data.roomCode = room.code;
  socket.data.playerId = playerId;
  socket.data.sessionId = sessionId;
  socketRoom.set(socket.id, room.code);
  void socket.join(`room:${room.code}`);
}

/** 手牌是私有信息：按查看者逐个 socket 下发视图。 */
function broadcastState(room: Room): void {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomCode !== room.code) continue;
    const viewerId = typeof socket.data.playerId === 'string' ? socket.data.playerId : undefined;
    socket.emit('room:state', publicState(room, viewerId));
  }
}

function emitError(socket: Socket, error: unknown): void {
  socket.emit('room:error', { message: error instanceof Error ? error.message : '操作失败，请重试' });
}

function leaveCurrentRoom(socket: Socket, intentional: boolean): void {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  socketRoom.delete(socket.id);
  if (!room) return;
  const player = room.players.get(socket.data.playerId as string);
  if (!player) return broadcastState(room);
  if (intentional) {
    // 主动退出：大厅直接移除；对局中保留占位并标记离线，队友可继续推进
    room.players.delete(player.id);
    room.disconnectedAt.delete(player.id);
    if (room.hostId === player.id) {
      const nextHost = [...room.players.values()].find((p) => p.connected);
      if (nextHost) room.hostId = nextHost.id;
    }
  } else {
    player.connected = false;
    player.socketId = undefined;
    room.disconnectedAt.set(player.id, Date.now());
  }
  room.version += 1;
  io.in(`room:${room.code}`).emit('room:player-left', { playerId: player.id, name: player.name, temporary: !intentional });
  broadcastState(room);
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload, ack) => {
    try {
      const name = sanitizeName((payload as { name?: unknown })?.name);
      const rawSession = (payload as { sessionId?: unknown })?.sessionId;
      const sessionId = rawSession ? sanitizeSession(rawSession) : randomUUID();
      const player = makePlayer(name, sessionId, socket.id);
      const room = makeRoom(makeRoomCode(), player);
      rooms.set(room.code, room);
      bindSocket(socket, room, player.id, sessionId);
      ack?.({ ok: true, code: room.code });
      broadcastState(room);
    } catch (error) { ack?.({ ok: false }); emitError(socket, error); }
  });

  socket.on('room:join', (payload, ack) => {
    try {
      const { name: rawName, code, sessionId: rawSession } = (payload ?? {}) as { name?: unknown; code?: unknown; sessionId?: unknown };
      const room = getRoom(code);
      const sessionId = sanitizeSession(rawSession);
      const existing = [...room.players.values()].find((p) => p.sessionId === sessionId);
      if (existing) {
        existing.name = sanitizeName(rawName || existing.name);
        existing.connected = true;
        existing.socketId = socket.id;
        room.disconnectedAt.delete(existing.id);
        bindSocket(socket, room, existing.id, sessionId);
        ack?.({ ok: true, code: room.code, reconnected: true });
      } else {
        if (room.gameState !== 'lobby') throw new Error('对局进行中，暂不能中途加入');
        if (room.players.size >= 6) throw new Error('房间已满（最多 6 人）');
        const name = sanitizeName(rawName);
        if ([...room.players.values()].some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('昵称已被使用，请换一个昵称');
        const player = makePlayer(name, sessionId, socket.id);
        room.players.set(player.id, player);
        bindSocket(socket, room, player.id, sessionId);
        io.in(`room:${room.code}`).emit('room:player-joined', { playerId: player.id, name: player.name });
        ack?.({ ok: true, code: room.code, reconnected: false });
      }
      room.version += 1;
      broadcastState(room);
    } catch (error) { ack?.({ ok: false }); emitError(socket, error); }
  });

  socket.on('game:start', (_payload, ack) => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (room.hostId !== socket.data.playerId) throw new Error('只有房主可以开始行动');
      startGame(room);
      ack?.({ ok: true });
      broadcastState(room);
    } catch (error) { ack?.({ ok: false }); emitError(socket, error); }
  });

  socket.on('chip:choose', (payload, ack) => {
    try {
      const room = getRoom(socket.data.roomCode);
      const { value, sourcePlayerId } = (payload ?? {}) as { value?: unknown; sourcePlayerId?: unknown };
      const { action } = chooseChip(room, socket.data.playerId as string, value as number, sourcePlayerId as string | undefined);
      ack?.({ ok: true });
      io.in(`room:${room.code}`).emit('chip:event', action); // 旧事件名，保持兼容
      io.in(`room:${room.code}`).emit('chip:action', action);
      io.in(`room:${room.code}`).emit(action.actionType === 'steal' ? 'chip:stolen' : action.actionType === 'replace' ? 'chip:returned' : 'chip:action', action);
      broadcastState(room);
    } catch (error) { ack?.({ ok: false }); emitError(socket, error); }
  });

  socket.on('phase:next', (_payload, ack) => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (room.hostId !== socket.data.playerId) throw new Error('只有房主可以推进阶段');
      const allChosen = [...room.players.values()].every((p) => p.currentChip !== null);
      if (room.phase === 'river' && allChosen) settle(room);
      else revealNextPhase(room);
      ack?.({ ok: true });
      io.in(`room:${room.code}`).emit('game:phase', { phase: room.phase, phaseName: PHASE_NAMES[room.phase] });
      if (room.result) io.in(`room:${room.code}`).emit('game:result', room.result);
      broadcastState(room);
    } catch (error) { ack?.({ ok: false }); emitError(socket, error); }
  });

  socket.on('heist:next', (_payload, ack) => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (room.hostId !== socket.data.playerId) throw new Error('只有房主可以开启下一劫案');
      startNextHeist(room);
      ack?.({ ok: true });
      broadcastState(room);
    } catch (error) { ack?.({ ok: false }); emitError(socket, error); }
  });

  socket.on('player:kick', async (payload, ack) => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (room.hostId !== socket.data.playerId) throw new Error('只有房主可以移除玩家');
      if (room.gameState !== 'lobby') throw new Error('对局开始后不能移除玩家');
      const targetId = String((payload as { playerId?: unknown })?.playerId ?? '');
      if (!room.players.delete(targetId)) throw new Error('玩家不在房间里');
      room.version += 1;
      ack?.({ ok: true });
      for (const socketInRoom of await io.in(`room:${room.code}`).fetchSockets()) {
        if (socketInRoom.data.playerId === targetId) {
          socketInRoom.emit('room:kicked', { message: '你被房主移出了房间' });
          socketInRoom.leave(`room:${room.code}`);
          socketInRoom.data.roomCode = undefined;
          socketInRoom.data.playerId = undefined;
        }
      }
      broadcastState(room);
    } catch (error) { ack?.({ ok: false }); emitError(socket, error); }
  });

  socket.on('room:leave', (_payload, ack) => {
    leaveCurrentRoom(socket, true);
    ack?.({ ok: true });
    socket.emit('room:left');
  });

  socket.on('disconnect', () => leaveCurrentRoom(socket, false));
});

// 空房间定时清理：全员离线超过 30 分钟即解散
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyOnline = [...room.players.values()].some((p) => p.connected);
    if (!anyOnline && now - room.createdAt > 30 * 60 * 1000) rooms.delete(code);
  }
}, 60 * 1000).unref();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  httpServer.listen(PORT, HOST, () => {
    console.log(`纸牌帮·群友专属版已启动：http://${HOST}:${PORT}`);
  });
}
