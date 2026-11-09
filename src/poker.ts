export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type Card = { rank: Rank; suit: Suit };

export const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
export const RANK_LABEL: Record<number, string> = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };
export const HAND_NAMES = ['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺','皇家同花顺'] as const;

export type HandResult = { category: number; name: string; score: number[]; keyCards: string };

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ rank: (i + 2) as Rank, suit })));
}

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function combinations<T>(items: T[], count: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length === count) { result.push([...picked]); return; }
    for (let i = start; i <= items.length - (count - picked.length); i += 1) walk(i + 1, [...picked, items[i]]);
  };
  walk(0, []);
  return result;
}

function straightHigh(ranks: number[]): number {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const slice = unique.slice(i, i + 5);
    if (slice[0] - slice[4] === 4 && new Set(slice).size === 5) return slice[0];
  }
  return 0;
}

function evaluateFive(cards: Card[]): HandResult {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  ranks.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const straight = straightHigh(ranks);
  let category = 0; let score: number[];
  if (flush && straight) { category = straight === 14 ? 9 : 8; score = [category, straight]; }
  else if (groups[0][1] === 4) score = [7, groups[0][0], groups[1][0]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) score = [6, groups[0][0], groups[1][0]];
  else if (flush) score = [5, ...ranks];
  else if (straight) score = [4, straight];
  else if (groups[0][1] === 3) score = [3, groups[0][0], ...groups.slice(1).map(([r]) => r).sort((a,b)=>b-a)];
  else if (groups[0][1] === 2 && groups[1][1] === 2) score = [2, Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]];
  else if (groups[0][1] === 2) score = [1, groups[0][0], ...groups.slice(1).map(([r]) => r).sort((a,b)=>b-a)];
  else score = [0, ...ranks];
  category = score[0];
  const keyCards = score.slice(1).map((r) => RANK_LABEL[r] ?? String(r)).join('、');
  return { category, name: HAND_NAMES[category], score, keyCards };
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function evaluateBestHand(cards: Card[]): HandResult {
  if (cards.length < 5) throw new Error('至少需要五张牌');
  const results = combinations(cards, 5).map(evaluateFive);
  return results.sort((a, b) => compareScores(b.score, a.score))[0];
}

export function cardLabel(card: Card): string { return `${RANK_LABEL[card.rank]}${card.suit}`; }
