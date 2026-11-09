import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as clientIo, type Socket } from 'socket.io-client';
import { httpServer, rooms } from './server.js';

describe('Socket.IO 联机流程', () => {
  let clients: Socket[] = [];
  let port = 0;
  beforeAll(async () => { await new Promise<void>((resolve) => httpServer.listen(0, () => { const address = httpServer.address(); port = typeof address === 'object' && address ? address.port : 0; resolve(); })); });
  afterEach(async () => { clients.forEach((client) => client.close()); clients = []; });
  afterAll(async () => { await new Promise<void>((resolve) => httpServer.close(() => resolve())); });
  it('创建并加入房间后服务端维护统一状态', async () => {
    const connect = () => new Promise<Socket>((resolve) => { const client = clientIo(`http://127.0.0.1:${port}`, { transports: ['websocket'] }); clients.push(client); client.on('connect', () => resolve(client)); });
    const a = await connect(); const created = await new Promise<any>((resolve) => a.emit('room:create', { name: '小明', sessionId: 'session-a' }, resolve)); expect(created.ok).toBe(true);
    const b = await connect(); const joined = await new Promise<any>((resolve) => b.emit('room:join', { code: created.code, name: '小红', sessionId: 'session-b' }, resolve)); expect(joined.ok).toBe(true);
    expect(rooms.get(created.code)?.players.size).toBe(2);
    const duplicate = await new Promise<any>((resolve) => b.emit('room:join', { code: created.code, name: '小红', sessionId: 'session-c' }, resolve)); expect(duplicate.ok).toBe(false);
    const c = await connect(); const joinedC = await new Promise<any>((resolve) => c.emit('room:join', { code: created.code, name: '小刚', sessionId: 'session-c' }, resolve)); expect(joinedC.ok).toBe(true);
    const actionReceived = new Promise<any>((resolve) => b.once('chip:action', resolve));
    const started = await new Promise<any>((resolve) => a.emit('game:start', {}, resolve)); expect(started.ok).toBe(true);
    const acted = await new Promise<any>((resolve) => a.emit('chip:choose', { value: 1 }, resolve)); expect(acted.ok).toBe(true);
    expect((await actionReceived).chipValue).toBe(1); expect(rooms.get(created.code)?.eventLog).toHaveLength(1);
  });
});
