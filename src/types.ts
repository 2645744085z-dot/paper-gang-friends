import type { Card, HandResult } from './poker.js';

export type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export const PHASES: Phase[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
export const PHASE_NAMES: Record<Phase, string> = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '结算' };
export type ActionType = 'take' | 'steal' | 'return' | 'replace';
export type ChipSource = 'center' | 'player';
export type PhaseChipHistory = Partial<Record<Phase, number | null>>;

export type ChipAction = {
  actionId: string; timestamp: number; phase: Phase; actorId: string; actorName: string;
  chipValue: number; sourceType: ChipSource; sourcePlayerId?: string; sourcePlayerName?: string;
  previousChip: number | null; affectedPlayerId?: string; affectedPlayerName?: string;
  actionType: ActionType; actorCounts: { phase: number; total: number; stealsMade: number };
  affectedCounts?: { phase: number; total: number; timesStolen: number };
};

export type Player = {
  id: string; sessionId: string; name: string; connected: boolean; socketId?: string;
  hand: Card[]; currentChip: number | null; chipHistory: PhaseChipHistory;
  phaseActionCount: number; totalActionCount: number; stealsMade: number; timesStolen: number; selectedAt?: number;
  lastActionAt?: number;
};

export type PlayerView = Omit<Player, 'hand'> & { hand?: Card[] };
export type ResultPlayer = { playerId: string; name: string; hand: Card[]; result: HandResult; finalChip: number | null; order: number };
export type GameResult = { heistNumber: number; success: boolean; alarms: number; vaults: number; players: ResultPlayer[]; resolvedAt: number; reason: string };

export type RoomStateView = {
  code: string; hostId: string; gameState: 'lobby' | 'playing' | 'result' | 'ended'; phase: Phase;
  heistNumber: number; alarms: number; vaults: number; communityCards: Card[]; availableChips: number[];
  players: PlayerView[]; eventLog: ChipAction[]; version: number; result?: GameResult; reconnectSeconds: number;
  viewerId?: string;
};
