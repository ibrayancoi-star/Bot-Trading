"use client";

import { create } from "zustand";
import { Timeframe } from "../types/market";
import { Signal } from "../types/trading";

export interface StrategyConfig {
  id: string;
  name: string;
  type: "ema-cross" | "rsi-reversal" | "macd-divergence" | "custom";
  enabled: boolean;
  symbols: string[];
  timeframe: Timeframe;
  params: Record<string, number>;
  riskPerTrade: number; // percentage of balance
  maxOpenPositions: number;
  stopLoss: number; // pips or percentage
  takeProfit: number; // pips or percentage
}

interface StrategyState {
  strategies: StrategyConfig[];
  activeStrategyId: string | null;
  signals: Signal[];
  
  // Actions
  addStrategy: (strategy: StrategyConfig) => void;
  removeStrategy: (id: string) => void;
  updateStrategy: (id: string, patch: Partial<StrategyConfig>) => void;
  activateStrategy: (id: string | null) => void;
  addSignal: (signal: Signal) => void;
  updateSignalStatus: (id: string, status: Signal["status"], error?: string) => void;
  clearSignals: () => void;
}

export const useStrategyStore = create<StrategyState>()((set) => ({
  strategies: [
    {
      id: "default-ema",
      name: "EMA Cross (9/21)",
      type: "ema-cross",
      enabled: false,
      symbols: ["EURUSD"],
      timeframe: "15m",
      params: {
        fastPeriod: 9,
        slowPeriod: 21,
      },
      riskPerTrade: 1,
      maxOpenPositions: 3,
      stopLoss: 20,
      takeProfit: 40,
    } as StrategyConfig,
    {
      id: "default-rsi",
      name: "RSI Reversal (14)",
      type: "rsi-reversal",
      enabled: false,
      symbols: ["EURUSD"],
      timeframe: "1h",
      params: {
        period: 14,
        overbought: 70,
        oversold: 30,
      },
      riskPerTrade: 1,
      maxOpenPositions: 2,
      stopLoss: 15,
      takeProfit: 30,
    } as StrategyConfig
  ],
  activeStrategyId: null,
  signals: [],

  addStrategy: (strategy) =>
    set((state) => ({
      strategies: [...state.strategies, strategy],
    })),

  removeStrategy: (id) =>
    set((state) => ({
      strategies: state.strategies.filter((s) => s.id !== id),
      activeStrategyId: state.activeStrategyId === id ? null : state.activeStrategyId,
    })),

  updateStrategy: (id, patch) =>
    set((state) => ({
      strategies: state.strategies.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    })),

  activateStrategy: (id) =>
    set({ activeStrategyId: id }),

  addSignal: (signal) =>
    set((state) => ({
      signals: [signal, ...state.signals].slice(0, 100), // Keep last 100
    })),

  updateSignalStatus: (id, status, error) =>
    set((state) => ({
      signals: state.signals.map((s) =>
        s.id === id ? { ...s, status, error } : s
      ),
    })),

  clearSignals: () => set({ signals: [] }),
}));
