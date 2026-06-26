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

// Rangos CRT calculados por el MISMO motor (crt_engine.select_range) y emitidos por el backend.
export interface AnchorRange {
  high: number;
  low: number;
  eq: number;
  bias: string;
  anchor_time: string;
  accumulation: boolean;
}

export interface DailyRange {
  high: number;
  low: number;
  open: number;
  close: number;
  bias: string;
  time: number;
}

export type BacktestStatus = "idle" | "running" | "completed" | "error";

// Segundos por temporalidad (visualización; el stream llega en base 1m).
const TF_SECONDS: Record<string, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "1d": 86400,
};

function tfSecs(tf: string): number {
  return TF_SECONDS[tf] ?? 60;
}

// Agrega una serie base 1m a la temporalidad pedida.
function aggregate(base: Candle[], tfSeconds: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of base) {
    const bucket = Math.floor(c.time / tfSeconds) * tfSeconds;
    if (!cur || bucket > cur.time) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 };
    } else {
      if (c.high > cur.high) cur.high = c.high;
      if (c.low < cur.low) cur.low = c.low;
      cur.close = c.close;
      cur.volume = (cur.volume ?? 0) + (c.volume ?? 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Recalcula SOLO el bucket actual a partir del tail de la serie base (las velas base están ordenadas).
function aggregateBucket(base: Candle[], bucket: number): Candle | null {
  let i = base.length - 1;
  const items: Candle[] = [];
  while (i >= 0 && base[i].time >= bucket) {
    items.push(base[i]);
    i--;
  }
  if (items.length === 0) return null;
  items.reverse();
  let high = items[0].high;
  let low = items[0].low;
  let volume = 0;
  for (const x of items) {
    if (x.high > high) high = x.high;
    if (x.low < low) low = x.low;
    volume += x.volume ?? 0;
  }
  return { time: bucket, open: items[0].open, high, low, close: items[items.length - 1].close, volume };
}

interface BacktestState {
  baseCandles: Candle[];   // serie base 1m autoritativa (mutada in-place para evitar copias O(n))
  candles: Candle[];       // serie AGREGADA a `timeframe` (la que pinta el chart)
  timeframe: string;       // temporalidad de visualización
  anchorRange: AnchorRange | null;
  dailyRange: DailyRange | null;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  status: BacktestStatus;
  isRunning: boolean;
  progress: { current: number; total: number };
  errorMessage?: string;

  // Actions
  appendBaseCandle: (candle: Candle) => void;
  setTimeframe: (tf: string) => void;
  setAnchorRange: (r: AnchorRange | null) => void;
  setDailyRange: (r: DailyRange | null) => void;
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
  unvalidatedTradesCount: 0,
};

export const useBacktestStore = create<BacktestState>((set) => ({
  baseCandles: [],
  candles: [],
  timeframe: "1m",
  anchorRange: null,
  dailyRange: null,
  trades: [],
  equityCurve: [],
  metrics: { ...initialMetrics },
  status: "idle",
  isRunning: false,
  progress: { current: 0, total: 0 },
  errorMessage: undefined,

  // Llega una vela base 1m (forming o cerrada). Se actualiza la base in-place y se re-agrega
  // únicamente el bucket actual de la temporalidad de visualización.
  appendBaseCandle: (bc) => set((state) => {
    const base = state.baseCandles;
    const lastBase = base.length ? base[base.length - 1] : null;
    if (lastBase && bc.time < lastBase.time) {
      return {};                         // vela obsoleta (bucle moribundo): descartar, mantener orden
    }
    if (lastBase && lastBase.time === bc.time) {
      base[base.length - 1] = bc;        // update del 1m en formación
    } else {
      base.push(bc);                     // nueva vela 1m
    }

    const tf = tfSecs(state.timeframe);
    const bucket = Math.floor(bc.time / tf) * tf;
    const agg = aggregateBucket(base, bucket);
    if (!agg) return {};

    const candles = state.candles;
    const last = candles[candles.length - 1];
    const newCandles = (last && last.time === bucket)
      ? [...candles.slice(0, -1), agg]
      : [...candles, agg];
    return { candles: newCandles };
  }),

  // Cambio de temporalidad en caliente: re-agrega toda la base (sin tocar el backend).
  setTimeframe: (tf) => set((state) => ({
    timeframe: tf,
    candles: aggregate(state.baseCandles, tfSecs(tf)),
  })),

  setAnchorRange: (anchorRange) => set({ anchorRange }),
  setDailyRange: (dailyRange) => set({ dailyRange }),

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
    equityCurve: [...state.equityCurve, point],
  })),
  setMetrics: (metrics) => set({ metrics }),
  setStatus: (status) => set({ status }),
  setIsRunning: (isRunning) => set({ isRunning }),
  setProgress: (current, total) => set({ progress: { current, total } }),
  setError: (errorMessage) => set({ status: "error", errorMessage, isRunning: false }),
  clearBacktest: () => set({
    baseCandles: [],
    candles: [],
    anchorRange: null,
    dailyRange: null,
    trades: [],
    equityCurve: [],
    metrics: { ...initialMetrics },
    status: "idle",
    isRunning: false,
    progress: { current: 0, total: 0 },
    errorMessage: undefined,
  }),
}));
