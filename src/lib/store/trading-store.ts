"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TradeResult, TTPChallenge, BrokerConnection } from "../types/trading";
import { HistoricalTrade } from "../types/market";

// [POSITIONS MODULE]
export interface Position {
  ticket:        number;
  symbol:        string;
  type:          "buy" | "sell";
  volume:        number;
  open_price:    number;
  current_price: number;
  sl:            number;
  tp:            number;
  profit:        number;
  time:          number;
}

export interface ClosedTrade extends Position {
  close_price: number;
  close_time:  number;
  pnl:         number;
}

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

export type Strategy = "scalping" | "swing" | "breakout" | "reversal";
export type KillzoneName = "london" | "newyork" | "asian" | "overlap";

export interface BotConfig {
  strategy: Strategy;
  lotSize: number;
  takeProfitPips: number;
  stopLossPips: number;
  maxPositions: number;
  maxDailyLoss: number;
  chromaThreshold: number;
  chromaTopK: number;
  killzones: Record<KillzoneName, boolean>;
  trailingStop: boolean;
  partialClose: boolean;
  partialClosePct: number;
  modelTbsRiskMultiplier: number;
  modelTwsRiskMultiplier: number;
  hybridM1M15Confluence: boolean;
  smtDivergenceCheck: boolean;

  // ── Killzones dinámicas ─────────────────────────────
  londonStart:   string;   // "07:00" (UTC)
  londonEnd:     string;   // "10:00" (UTC)
  newYorkStart:  string;   // "12:00" (UTC)
  newYorkEnd:    string;   // "15:00" (UTC)
  asianStart:    string;   // "02:00" (UTC)
  asianEnd:      string;   // "05:00" (UTC)

  // ── Filtros con bypass ──────────────────────────────
  maxSpreadPoints:    number;   // Spread máximo en puntos
  disableSpreadFilter: boolean; // true = ignorar el filtro de spread

  minAtrPips:         number;   // ATR mínimo requerido en pips
  disableAtrFilter:   boolean;  // true = ignorar el filtro de ATR

  // ── Bypass de validación de mecha CRT ──────────────
  maxWickBodyRatio:         number;   // % máx del cuerpo sobre la vela (defecto: 20)
  disableWickBodyFilter:    boolean;  // true = ignorar la regla del 20%

  // [BYPASS DIMENSIÓN]
  disableDimensionFilter:       boolean;
  minAmplitudeForexPct:         number;
  minAmplitudeIndicesPoints:    number;
}

interface TradingState {
  accountType: "real" | "fondeo" | "demo";
  account: PropAccount;
  config: TTPChallenge;
  positions: any[]; // [POSITIONS MODULE] updated to any[] to avoid conflict with TradePosition and Position
  logs: TradeResult[];
  risk: RiskMetrics;
  connection: BrokerConnection;
  isBotActive: boolean;
  botActiveSymbols: string[];
  algoTradingEnabled: boolean;
  notifications: TradeNotification[];
  knownAccounts: Record<string, KnownAccount>;
  historicalTrades: HistoricalTrade[];
  botConfig: BotConfig;
  isLeftSidebarOpen: boolean;

  // [POSITIONS MODULE]
  tradeHistory: ClosedTrade[];

  // Acciones
  setPositions:      (positions: Position[]) => void;
  initHistory:       (trades: ClosedTrade[]) => void;
  appendHistory:     (trade: ClosedTrade) => void;

  // Actions
  setAccountType: (type: "real" | "fondeo" | "demo") => void;
  updateEquity: (newEquity: number) => void;
  addPosition: (position: TradePosition) => void;
  closePosition: (id: string, result: TradeResult) => void;
  toggleBot: () => void;
  toggleBotSymbol: (symbol: string) => void;
  syncAccountFromAPI: (account: Partial<PropAccount>, positions: TradePosition[]) => void;
  checkRiskLimits: () => void;
  logTrade: (result: TradeResult) => void;
  addNotification: (type: TradeNotification["type"], message: string) => void;
  dismissNotification: (id: string) => void;
  registerKnownAccount: (login: number, server: string, type: "real" | "fondeo" | "demo") => void;
  setHistoricalTrades: (trades: HistoricalTrade[]) => void;
  addHistoricalTrade: (trade: HistoricalTrade) => void;
  setBotConfig: (config: BotConfig) => void;
  toggleLeftSidebar: () => void;
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
      botActiveSymbols: ["EURUSD", "GBPUSD"],
      algoTradingEnabled: false,
      notifications: [],
      knownAccounts: {},
      historicalTrades: [],
      botConfig: {
        strategy: "scalping",
        lotSize: 0.1,
        takeProfitPips: 20,
        stopLossPips: 15,
        maxPositions: 3,
        maxDailyLoss: 2.5,
        chromaThreshold: 0.72,
        chromaTopK: 5,
        killzones: { asian: false, london: true, overlap: true, newyork: false },
        trailingStop: false,
        partialClose: false,
        partialClosePct: 50,
        modelTbsRiskMultiplier: 1.0,
        modelTwsRiskMultiplier: 0.5,
        hybridM1M15Confluence: true,
        smtDivergenceCheck: true,

        londonStart:   "07:00",
        londonEnd:     "10:00",
        newYorkStart:  "12:00",
        newYorkEnd:    "15:00",
        asianStart:    "02:00",
        asianEnd:      "05:00",

        maxSpreadPoints:       20,
        disableSpreadFilter:   false,

        minAtrPips:            12,
        disableAtrFilter:      false,

        maxWickBodyRatio:      20,
        disableWickBodyFilter: false,

        // [BYPASS DIMENSIÓN]
        disableDimensionFilter:       false,
        minAmplitudeForexPct:         0.08,
        minAmplitudeIndicesPoints:    20.0,
      },
      isLeftSidebarOpen: false,

      // [POSITIONS MODULE]
      tradeHistory: [],

      // [POSITIONS MODULE]
      setPositions:  (positions) => set({ positions }),
      initHistory:   (trades)    => set({ tradeHistory: trades }),
      appendHistory: (trade)     => set((state) => ({
        tradeHistory: [trade, ...state.tradeHistory].slice(0, 500) // cap en 500
      })),

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

      toggleBotSymbol: (symbol) =>
        set((state) => ({
          botActiveSymbols: state.botActiveSymbols.includes(symbol)
            ? state.botActiveSymbols.filter((s) => s !== symbol)
            : [...state.botActiveSymbols, symbol],
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

      setBotConfig: (config) => {
        set({ botConfig: config });
        import("@/lib/data/mock-feed").then(({ sendBotConfig }) => {
          sendBotConfig(config);
        }).catch(err => {
          console.error("Error importando sendBotConfig:", err);
        });
      },

      toggleLeftSidebar: () =>
        set((state) => ({
          isLeftSidebarOpen: !state.isLeftSidebarOpen,
        })),
    }),
    {
      name: "ttp-trading-state",
      partialize: (state) => ({ knownAccounts: state.knownAccounts }),
    }
  )
);
