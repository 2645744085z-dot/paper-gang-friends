import { describe, expect, it } from 'vitest';
import { makePlayer, makeRoom, startGame, revealNextPhase, chooseChip, settle, startNextHeist, publicState } from '../src/game.js';
import type { Room } from '../src/game.js';
import type { Card } from '../src/poker.js';

const card = (rank: number, suit: Card['suit']): Card => ({ rank: rank as Card['rank'], suit });

function buildRoom(playerCount = 3): Room {
  const players = Array.from({ length: playerCount }, (_, i) => makePlayer(`玩家${i + 1}`, `session-${i}`, `socket-${i}`));
  const room = makeRoom('TEST01', players[0]);
  for (const p of players.slice(1)) room.players.set(p.id, p);
  startGame(room);
  return room;
}

/** 强制布置牌面：社区牌 + 各家手牌，保证牌力 p1 < p2 < p3 */
function rigHands(room: Room) {
  room.communityCards = [card(4, '♥'), card(6, '♦'), card(8, '♣'), card(10, '♠'), card(11, '♠')];
  const hands = [
    [card(2, '♠'), card(3, '♦')], // 高牌
    [card(9, '♠'), card(9, '♥')], // 一对 9
    [card(12, '♣'), card(12, '♥')], // 一对 Q
  ];
  [...room.players.values()].forEach((p, i) => { p.hand = hands[i]; });
}

function ids(room: Room): string[] {
  return [...room.players.keys()];
}

describe('开局', () => {
  it('少于 3 人不能开始', () => {
    const room = makeRoom('TEST02', makePlayer('房主', 's0', 'k0'));
    room.players.set('p2', makePlayer('乙', 's2', 'k2'));
    expect(() => startGame(room)).toThrow('需要 3–6 位正式玩家才能开始');
  });

  it('开局后每人两张手牌、公共池筹码 1..N', () => {
    const room = buildRoom(4);
    expect(room.gameState).toBe('playing');
    for (const p of room.players.values()) expect(p.hand).toHaveLength(2);
    expect(room.availableChips).toEqual([1, 2, 3, 4]);
  });
});

describe('抢筹', () => {
  it('从公共池拿筹码', () => {
    const room = buildRoom(3);
    const [a, b, c] = ids(room);
    const { action } = chooseChip(room, a, 2);
    expect(action.actionType).toBe('take');
    expect(room.players.get(a)!.currentChip).toBe(2);
    expect(room.availableChips).toEqual([1, 3]);
    expect(room.eventLog).toHaveLength(1);
  });

  it('抢走他人筹码：被抢者筹码清空并重新选择', () => {
    const room = buildRoom(3);
    const [a, b] = ids(room);
    chooseChip(room, a, 2);
    const { action, affected } = chooseChip(room, b, 2, a);
    expect(action.actionType).toBe('steal');
    expect(room.players.get(b)!.currentChip).toBe(2);
    expect(room.players.get(a)!.currentChip).toBeNull();
    expect(room.players.get(a)!.timesStolen).toBe(1);
    expect(room.players.get(b)!.stealsMade).toBe(1);
    expect(affected?.id).toBe(a);
  });

  it('换筹：旧筹码自动归还公共池', () => {
    const room = buildRoom(3);
    const [a] = ids(room);
    chooseChip(room, a, 1);
    const { action } = chooseChip(room, a, 3);
    expect(action.actionType).toBe('replace');
    expect(action.previousChip).toBe(1);
    expect(room.availableChips).toEqual([1, 2]);
  });

  it('非法操作全部拒绝', () => {
    const room = buildRoom(3);
    const [a, b] = ids(room);
    chooseChip(room, a, 1);
    expect(() => chooseChip(room, a, 1, a)).toThrow('不能抢自己的筹码');
    expect(() => chooseChip(room, b, 1, a)).not.toThrow();
    expect(() => chooseChip(room, b, 1)).toThrow('这枚筹码已被拿走');
    expect(() => chooseChip(room, b, 9)).toThrow('筹码星级无效');
  });
});

describe('阶段推进', () => {
  it('有人未选筹码时不能推进', () => {
    const room = buildRoom(3);
    const [a, b, c] = ids(room);
    chooseChip(room, a, 1);
    chooseChip(room, b, 2);
    expect(() => revealNextPhase(room)).toThrow('还有玩家没有选择筹码');
    chooseChip(room, c, 3);
    expect(revealNextPhase(room)).toBe('flop');
  });

  it('翻牌/转牌/河牌逐次发牌，阶段筹码清零重选', () => {
    const room = buildRoom(3);
    const idsList = ids(room);
    idsList.forEach((id, i) => chooseChip(room, id, i + 1));
    expect(revealNextPhase(room)).toBe('flop');
    expect(room.communityCards).toHaveLength(3);
    for (const p of room.players.values()) {
      expect(p.currentChip).toBeNull();
      expect(p.chipHistory.preflop).not.toBeNull();
    }
    idsList.forEach((id, i) => chooseChip(room, id, i + 1));
    expect(revealNextPhase(room)).toBe('turn');
    expect(room.communityCards).toHaveLength(4);
    idsList.forEach((id, i) => chooseChip(room, id, i + 1));
    expect(revealNextPhase(room)).toBe('river');
    expect(room.communityCards).toHaveLength(5);
  });
});

describe('结算', () => {
  it('筹码顺序与牌力从弱到强一致 → 开保险箱', () => {
    const room = buildRoom(3);
    rigHands(room);
    room.phase = 'river';
    const [a, b, c] = ids(room);
    [a, b, c].forEach((id, i) => { room.players.get(id)!.currentChip = i + 1; room.players.get(id)!.chipHistory.river = i + 1; });
    const result = settle(room);
    expect(result.success).toBe(true);
    expect(room.vaults).toBe(1);
    expect(result.players[0].result.name).toBe('一对');
    expect(result.players[2].result.name).toBe('高牌');
  });

  it('顺序错乱 → 警报 +1', () => {
    const room = buildRoom(3);
    rigHands(room);
    room.phase = 'river';
    const [a, b, c] = ids(room);
    room.players.get(a)!.currentChip = 3;
    room.players.get(b)!.currentChip = 2;
    room.players.get(c)!.currentChip = 1;
    const result = settle(room);
    expect(result.success).toBe(false);
    expect(room.alarms).toBe(1);
  });

  it('未到河牌不能结算', () => {
    const room = buildRoom(3);
    expect(() => settle(room)).toThrow('还没有到结算阶段');
  });
});

describe('劫案循环与终局', () => {
  it('三响警报后行动结束', () => {
    const room = buildRoom(3);
    room.gameState = 'result';
    room.alarms = 2;
    startNextHeist(room);
    expect(room.gameState).toBe('playing');
    room.gameState = 'result';
    room.alarms = 3;
    startNextHeist(room);
    expect(room.gameState).toBe('ended');
  });

  it('三只保险箱全开后胜利终局', () => {
    const room = buildRoom(3);
    room.gameState = 'result';
    room.vaults = 3;
    startNextHeist(room);
    expect(room.gameState).toBe('ended');
  });
});

describe('状态视图', () => {
  it('手牌只对本人可见', () => {
    const room = buildRoom(3);
    const [a, b] = ids(room);
    const own = publicState(room, a);
    const other = publicState(room, b);
    const guest = publicState(room);
    expect(own.players.find((p) => p.id === a)!.hand).toHaveLength(2);
    expect(own.players.find((p) => p.id === b)!.hand).toBeUndefined();
    expect(other.players.find((p) => p.id === b)!.hand).toHaveLength(2);
    expect(guest.players.every((p) => p.hand === undefined)).toBe(true);
    expect(own.viewerId).toBe(a);
  });
});
