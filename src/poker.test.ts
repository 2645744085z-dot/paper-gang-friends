import { describe, expect, it } from 'vitest';
import { evaluateBestHand } from './poker.js';
import type { Card } from './poker.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('德州扑克牌型评估', () => {
  it('识别皇家同花顺', () => expect(evaluateBestHand([c(14,'♠'),c(13,'♠'),c(12,'♠'),c(11,'♠'),c(10,'♠'),c(2,'♥'),c(3,'♦')]).name).toBe('皇家同花顺'));
  it('识别 A2345 低顺子', () => { const result = evaluateBestHand([c(14,'♠'),c(2,'♥'),c(3,'♦'),c(4,'♣'),c(5,'♠'),c(9,'♥'),c(13,'♦')]); expect(result.name).toBe('顺子'); expect(result.score[1]).toBe(5); });
  it('识别四条和葫芦', () => { const four = evaluateBestHand([c(9,'♠'),c(9,'♥'),c(9,'♦'),c(9,'♣'),c(2,'♠'),c(2,'♥'),c(4,'♦')]); const full = evaluateBestHand([c(8,'♠'),c(8,'♥'),c(8,'♦'),c(7,'♣'),c(7,'♠'),c(2,'♥'),c(4,'♦')]); expect(four.name).toBe('四条'); expect(full.name).toBe('葫芦'); expect(four.category).toBeGreaterThan(full.category); });
  it('两对比较使用高对', () => { const high = evaluateBestHand([c(14,'♠'),c(14,'♥'),c(13,'♦'),c(13,'♣'),c(2,'♠'),c(3,'♥'),c(4,'♦')]); const low = evaluateBestHand([c(13,'♠'),c(13,'♥'),c(12,'♦'),c(12,'♣'),c(14,'♠'),c(3,'♥'),c(4,'♦')]); expect(high.score[1]).toBe(14); expect(high.score[1]).toBeGreaterThan(low.score[1]); });
});
