"use client";

import { create } from "zustand";
import type { Candle } from "@/lib/types/market";

export interface BacktestTrade {
  ticket: number;
  symbol: string;
  type: "buy" | "sell";
  volume: number;
  open_price: number;
  close_price?: number;
  sl: number;
  tp: number;
  time: number;
  close_time?: number;
  pnl?: number;
  pnl_pips?: number;
  status: "open" | "closed";
  chromadb_validated: boolean;
  reason?: string;
}

export interface BacktestMetrics {
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
  unvalidatedTradesCount: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export type BacktestStatus = "idle" | "running" | "completed" | "error";

interface BacktestState {
  candles: Candle[];
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  status: BacktestStatus;
  isRunning: boolean;
  progress: { current: number; total: number };
  errorMessage?: string;

  // Actions
  setCandles: (candles: Candle[]) => void;
  appendCandle: (candle: Candle) => void;
  addOrUpdateTrade: (trade: BacktestTrade) => void;
  appendEquityPoint: (point: EquityPoint) => void;
  setMetrics: (metrics: BacktestMetrics) => void;
  setStatus: (status: BacktestStatus) => void;
  setIsRunning: (isRunning: boolean) => void;
  setProgress: (current: number, total: number) => void;
  setError: (msg: string) => void;
  clearBacktest: () => void;
}

const initialMetrics: BacktestMetrics = {
  winRate: 0,
  profitFactor: 0,
  maxDrawdown: 0,
  sharpeRatio: 0,
  totalTrades: 0,
  unvalidatedTradesCount: 0
};

export const useBacktestStore = create<BacktestState>((set) => ({
  candles: [],
  trades: [],
  equityCurve: [],
  metrics: { ...initialMetrics },
  status: "idle",
  isRunning: false,
  progress: { current: 0, total: 0 },
  errorMessage: undefined,

  setCandles: (candles) => set({ candles }),
  appendCandle: (candle) => set((state) => {
    // If the candle with this timestamp exists, replace it, otherwise append.
    const existingIndex = state.candles.findIndex((c) => c.time === candle.time);
    if (existingIndex !== -1) {
      const updated = [...state.candles];
      updated[existingIndex] = candle;
      return { candles: updated };
    }
    return { candles: [...state.candles, candle] };
  }),
  addOrUpdateTrade: (trade) => set((state) => {
    const existingIndex = state.trades.findIndex((t) => t.ticket === trade.ticket);
    if (existingIndex !== -1) {
      const updated = [...state.trades];
      updated[existingIndex] = trade;
      return { trades: updated };
    }
    return { trades: [...state.trades, trade] };
  }),
  appendEquityPoint: (point) => set((state) => ({
    equityCurve: [...state.equityCurve, point]
  })),
  setMetrics: (metrics) => set({ metrics }),
  setStatus: (status) => set({ status }),
  setIsRunning: (isRunning) => set({ isRunning }),
  setProgress: (current, total) => set({ progress: { current, total } }),
  setError: (errorMessage) => set({ status: "error", errorMessage, isRunning: false }),
  clearBacktest: () => set({
    candles: [],
    trades: [],
    equityCurve: [],
    metrics: { ...initialMetrics },
    status: "idle",
    isRunning: false,
    progress: { current: 0, total: 0 },
    errorMessage: undefined
  }),
}));
