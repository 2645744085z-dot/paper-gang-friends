import type { GameResult, ResultPlayer } from './types.js';

export const HAND_RULES = [
  { rank: 10, name: '皇家同花顺', detail: '同一花色的 A、K、Q、J、10。' },
  { rank: 9, name: '同花顺', detail: '同一花色的连续五张牌。' },
  { rank: 8, name: '四条', detail: '四张点数相同的牌，加一张踢脚牌。' },
  { rank: 7, name: '葫芦', detail: '三条加一对。' },
  { rank: 6, name: '同花', detail: '五张同一花色的牌，点数不连续。' },
  { rank: 5, name: '顺子', detail: '五张连续点数的牌，花色可不同；A2345 为最小顺子。' },
  { rank: 4, name: '三条', detail: '三张点数相同的牌，加两张踢脚牌。' },
  { rank: 3, name: '两对', detail: '两组对子，加一张踢脚牌。' },
  { rank: 2, name: '一对', detail: '一组对子，加三张踢脚牌。' },
  { rank: 1, name: '高牌', detail: '不满足以上牌型时，依次比较最大单牌。' },
] as const;

export type OrderSlot = {
  chipValue: number;
  target: Pick<ResultPlayer, 'playerId' | 'name' | 'targetChip' | 'result'>;
  actual?: Pick<ResultPlayer, 'playerId' | 'name' | 'finalChip' | 'result'>;
  correct: boolean;
  explanation: string;
};

/** 按筹码从低到高组织目标顺序和实际顺序，供结算界面与测试共用。 */
export function buildOrderComparison(result: GameResult): OrderSlot[] {
  const targets = [...result.players].sort((a, b) => a.targetChip - b.targetChip);
  const actuals = [...result.players].sort((a, b) => (a.finalChip ?? Number.MAX_SAFE_INTEGER) - (b.finalChip ?? Number.MAX_SAFE_INTEGER));
  return targets.map((target, index) => {
    const actual = actuals[index];
    const correct = actual?.playerId === target.playerId && actual?.finalChip === target.targetChip;
    return {
      chipValue: target.targetChip,
      target,
      actual,
      correct,
      explanation: correct
        ? `${target.name} 的牌力与 ${target.targetChip} 星筹码相符。`
        : `${target.name} 应拿 ${target.targetChip} 星筹码；实际该位置是 ${actual ? `${actual.name} 的 ${actual.finalChip} 星筹码` : '未选择筹码'}。`,
    };
  });
}
