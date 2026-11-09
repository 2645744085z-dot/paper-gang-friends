import { describe, expect, it } from 'vitest';
import { chooseChip, makePlayer, makeRoom, startGame } from './game.js';

describe('服务端筹码状态', () => {
  it('抢筹会清空被抢者并记录次数', () => {
    const host = makePlayer('甲', 'a', 'socket-a'); const room = makeRoom('ABC123', host);
    const b = makePlayer('乙', 'b', 'socket-b'); const c = makePlayer('丙', 'c', 'socket-c'); room.players.set(b.id, b); room.players.set(c.id, c); startGame(room);
    chooseChip(room, host.id, 1); chooseChip(room, b.id, 2); const event = chooseChip(room, c.id, 2, b.id).action;
    expect(event.actionType).toBe('steal'); expect(room.players.get(b.id)?.currentChip).toBeNull(); expect(room.players.get(c.id)?.currentChip).toBe(2); expect(room.players.get(b.id)?.timesStolen).toBe(1);
  });
});
