"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TradeResult, TTPChallenge, BrokerConnection } from "../types/trading";
import { HistoricalTrade } from "../types/market";

export interface PropAccount {
  balance: number;
  equity: number;
  dailyDrawdownLimit: number;
  maxDrawdownLimit: number;
  profitTarget: number;
  status: "active" | "passed" | "failed";
  server?: string;
  login?: number;
}

export interface KnownAccount {
  login: number;
  server: string;
  type: "real" | "fondeo" | "demo";
  lastSeen: number;
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

export interface TradeNotification {
  id: string;
  type: "success" | "error" | "warning";
  message: string;
  timestamp: number;
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
  algoTradingEnabled: boolean;
  notifications: TradeNotification[];
  knownAccounts: Record<string, KnownAccount>;
  historicalTrades: HistoricalTrade[];

  // Actions
  setAccountType: (type: "real" | "fondeo" | "demo") => void;
  updateEquity: (newEquity: number) => void;
  addPosition: (position: TradePosition) => void;
  closePosition: (id: string, result: TradeResult) => void;
  toggleBot: () => void;
  syncAccountFromAPI: (account: Partial<PropAccount>, positions: TradePosition[]) => void;
  checkRiskLimits: () => void;
  logTrade: (result: TradeResult) => void;
  addNotification: (type: TradeNotification["type"], message: string) => void;
  dismissNotification: (id: string) => void;
  registerKnownAccount: (login: number, server: string, type: "real" | "fondeo" | "demo") => void;
  setHistoricalTrades: (trades: HistoricalTrade[]) => void;
  addHistoricalTrade: (trade: HistoricalTrade) => void;
}

export const useTradingStore = create<TradingState>()(
  persist(
    (set, get) => ({
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
      algoTradingEnabled: false,
      notifications: [],
      knownAccounts: {},
      historicalTrades: [],

      setAccountType: (type) => set({ accountType: type }),
      setHistoricalTrades: (trades) => set({ historicalTrades: trades }),
      addHistoricalTrade: (trade) =>
        set((state) => ({
          historicalTrades: [
            trade,
            ...state.historicalTrades.filter((t) => t.id !== trade.id),
          ].slice(0, 50), // Guardar hasta 50 últimos trades
        })),

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

      addNotification: (type, message) =>
        set((state) => ({
          notifications: [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              type,
              message,
              timestamp: Date.now(),
            },
            ...state.notifications,
          ].slice(0, 10), // Max 10 notifications
        })),

      dismissNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      registerKnownAccount: (login, server, type) =>
        set((state) => {
          const key = `${server}_${login}`;
          return {
            knownAccounts: {
              ...state.knownAccounts,
              [key]: {
                login,
                server,
                type,
                lastSeen: Date.now(),
              },
            },
          };
        }),
    }),
    {
      name: "ttp-trading-state",
      partialize: (state) => ({ knownAccounts: state.knownAccounts }),
    }
  )
);
