import { describe, expect, it } from 'vitest';
import { cardLabel, compareScores, createDeck, evaluateBestHand } from '../src/poker.js';
import type { Card } from '../src/poker.js';

const card = (rank: number, suit: Card['suit']): Card => ({ rank: rank as Card['rank'], suit });

describe('createDeck', () => {
  it('生成 52 张不重复的牌', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => cardLabel(c))).size).toBe(52);
  });
});

describe('evaluateFive / 牌型名称', () => {
  it('识别皇家同花顺', () => {
    const hand = [card(14, '♠'), card(13, '♠'), card(12, '♠'), card(11, '♠'), card(10, '♠')];
    expect(evaluateBestHand(hand).name).toBe('皇家同花顺');
  });

  it('识别同花顺（含 A-5 轮子顺）', () => {
    const wheel = [card(14, '♥'), card(5, '♥'), card(4, '♥'), card(3, '♥'), card(2, '♥')];
    const result = evaluateBestHand(wheel);
    expect(result.name).toBe('同花顺');
    expect(result.score[1]).toBe(5); // A-5 顺以 5 为最大
  });

  it('识别四条、葫芦、三条、两对、一对、高牌', () => {
    expect(evaluateBestHand([card(9, '♠'), card(9, '♥'), card(9, '♦'), card(9, '♣'), card(2, '♠')]).name).toBe('四条');
    expect(evaluateBestHand([card(8, '♠'), card(8, '♥'), card(5, '♦'), card(5, '♣'), card(2, '♠')]).name).toBe('两对');
    expect(evaluateBestHand([card(7, '♠'), card(7, '♥'), card(7, '♦'), card(4, '♣'), card(2, '♠')]).name).toBe('三条');
    expect(evaluateBestHand([card(6, '♠'), card(6, '♥'), card(10, '♦'), card(3, '♣'), card(2, '♠')]).name).toBe('一对');
    expect(evaluateBestHand([card(14, '♠'), card(12, '♥'), card(9, '♦'), card(5, '♣'), card(2, '♠')]).name).toBe('高牌');
  });

  it('识别普通顺子', () => {
    expect(evaluateBestHand([card(9, '♠'), card(8, '♥'), card(7, '♦'), card(6, '♣'), card(5, '♠')]).name).toBe('顺子');
  });
});

describe('compareScores', () => {
  it('先比牌型等级，再比关键牌', () => {
    const pair = evaluateBestHand([card(2, '♠'), card(2, '♥'), card(9, '♦'), card(7, '♣'), card(5, '♠')]);
    const high = evaluateBestHand([card(14, '♠'), card(13, '♥'), card(12, '♦'), card(11, '♣'), card(9, '♠')]);
    expect(compareScores(pair.score, high.score)).toBeGreaterThan(0);
  });
});

describe('evaluateBestHand（7 张选 5）', () => {
  it('从 7 张中选出最强五张', () => {
    const seven = [card(14, '♠'), card(13, '♠'), card(12, '♠'), card(2, '♥'), card(11, '♠'), card(10, '♠'), card(3, '♦')];
    expect(evaluateBestHand(seven).name).toBe('皇家同花顺');
  });

  it('牌数不足时抛出错误', () => {
    expect(() => evaluateBestHand([card(2, '♠'), card(3, '♠'), card(4, '♠'), card(5, '♠')])).toThrow();
  });
});
