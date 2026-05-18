"use client";

import { create } from "zustand";
import { TradeResult, TTPChallenge, BrokerConnection } from "../types/trading";

export interface PropAccount {
  balance: number;
  equity: number;
  dailyDrawdownLimit: number;
  maxDrawdownLimit: number;
  profitTarget: number;
  status: "active" | "passed" | "failed";
}

export interface TradePosition {
  id: string; // Ticket string
  ticket?: number;
  symbol: string;
  type: "BUY" | "SELL";
  lotSize: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  sl?: number;
  tp?: number;
  time?: number;
}

export interface RiskMetrics {
  dailyPnL: number;
  currentDrawdown: number;
  remainingDailyLoss: number;
  remainingMaxLoss: number;
}

interface TradingState {
  accountType: "real" | "fondeo" | "demo";
  account: PropAccount;
  config: TTPChallenge;
  positions: TradePosition[];
  logs: TradeResult[];
  risk: RiskMetrics;
  connection: BrokerConnection;
  isBotActive: boolean;

  // Actions
  setAccountType: (type: "real" | "fondeo" | "demo") => void;
  updateEquity: (newEquity: number) => void;
  addPosition: (position: TradePosition) => void;
  closePosition: (id: string, result: TradeResult) => void;
  toggleBot: () => void;
  syncAccountFromAPI: (account: Partial<PropAccount>, positions: TradePosition[]) => void;
  checkRiskLimits: () => void;
  logTrade: (result: TradeResult) => void;
}

export const useTradingStore = create<TradingState>()((set, get) => ({
  accountType: "fondeo",
  account: {
    balance: 5000,
    equity: 5000,
    dailyDrawdownLimit: 250, // 5% of 5000
    maxDrawdownLimit: 500, // 10% of 5000
    profitTarget: 400, // 8% of 5000
    status: "active",
  },
  config: {
    id: "ttp-5k-f1",
    name: "TTP Phase 1 $5,000",
    size: 5000,
    dailyDrawdownLimit: 5,
    maxDrawdownLimit: 10,
    profitTarget: 8,
    maxDailyLoss: 250,
    maxOverallLoss: 500,
  },
  positions: [],
  logs: [],
  risk: {
    dailyPnL: 0,
    currentDrawdown: 0,
    remainingDailyLoss: 250,
    remainingMaxLoss: 500,
  },
  connection: {
    status: "disconnected",
  },
  isBotActive: false,

  setAccountType: (type) => set({ accountType: type }),

  updateEquity: (newEquity) => {
    set((state) => ({
      account: { ...state.account, equity: newEquity },
    }));
    get().checkRiskLimits();
  },

  addPosition: (position) =>
    set((state) => ({
      positions: [...state.positions, position],
    })),

  closePosition: (id, result) => {
    set((state) => ({
      positions: state.positions.filter((p) => p.id !== id),
      logs: [result, ...state.logs],
    }));
    get().checkRiskLimits();
  },

  toggleBot: () =>
    set((state) => ({
      isBotActive: !state.isBotActive,
    })),

  syncAccountFromAPI: (accountPatch, positions) =>
    set((state) => ({
      account: { ...state.account, ...accountPatch },
      positions,
    })),

  checkRiskLimits: () => {
    const { account, config, logs } = get();
    const dailyPnL = logs.reduce((acc, log) => {
      const isToday = new Date(log.closedAt).toDateString() === new Date().toDateString();
      return isToday ? acc + log.pnl : acc;
    }, 0);

    const currentDrawdown = account.balance - account.equity;
    const remainingDailyLoss = config.maxDailyLoss - (dailyPnL < 0 ? Math.abs(dailyPnL) : 0) - (currentDrawdown > 0 ? currentDrawdown : 0);
    const remainingMaxLoss = config.maxOverallLoss - currentDrawdown;

    let status = account.status;
    if (remainingDailyLoss <= 0 || remainingMaxLoss <= 0) {
      status = "failed";
    } else if (account.balance >= config.size + config.profitTarget) {
      status = "passed";
    }

    set({
      account: { ...account, status },
      risk: {
        dailyPnL,
        currentDrawdown,
        remainingDailyLoss,
        remainingMaxLoss,
      },
    });
  },

  logTrade: (result) =>
    set((state) => ({
      logs: [result, ...state.logs],
    })),
}));
