import type { Candle, Ticker24h, SymbolInfo } from "@/lib/types/market";

// ─── EURUSD simulation parameters ────────────────────────────────────────────
const BASE_PRICE = 1.085;
const CANDLE_DURATION_SECONDS = 60; // 1-minute candles
const TICK_INTERVAL_MS = 1500; // emit a tick every 1.5 s
const TICK_MOVE = 0.00025; // max price move per tick (~2.5 pips)
const CANDLE_MOVE = 0.0008; // typical body size per candle (~8 pips)
const PRICE_MIN = 1.05;
const PRICE_MAX = 1.15;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round5(n: number): number {
  return parseFloat(n.toFixed(5));
}

function clamp(n: number): number {
  return Math.max(PRICE_MIN, Math.min(PRICE_MAX, n));
}

/**
 * Generate a single completed OHLCV candle given its open timestamp and
 * an opening price (= previous close). Applies a small random walk to
 * produce realistic intra-candle highs/lows and a close.
 */
function buildCandle(time: number, open: number): Candle {
  const drift = (Math.random() - 0.47) * CANDLE_MOVE; // slight bull bias
  const close = round5(clamp(open + drift));
  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);
  const high = round5(clamp(bodyHigh + Math.random() * CANDLE_MOVE * 0.6));
  const low = round5(clamp(bodyLow - Math.random() * CANDLE_MOVE * 0.6));
  const volume = Math.floor(Math.random() * 600 + 200);
  return { time, open: round5(open), high, low, close, volume, isFinal: true };
}

// ─── Historical data generator ────────────────────────────────────────────────

/**
 * Returns `count` completed EURUSD 1-minute candles finishing just before now.
 */
export function generateHistoricalData(count: number): Candle[] {
  const candles: Candle[] = [];
  const now = Math.floor(Date.now() / 1000);
  // Align to the last completed minute boundary
  const latestClose = now - (now % CANDLE_DURATION_SECONDS);
  const startTime = latestClose - count * CANDLE_DURATION_SECONDS;

  let price = BASE_PRICE;
  for (let i = 0; i < count; i++) {
    const time = startTime + i * CANDLE_DURATION_SECONDS;
    const c = buildCandle(time, price);
    candles.push(c);
    price = c.close;
  }
  return candles;
}

// ─── Real-time tick subscription ──────────────────────────────────────────────

interface MockSubscription {
  onCandle: (c: Candle) => void;
}

let subscriptions: MockSubscription[] = [];
let tickTimer: ReturnType<typeof setInterval> | null = null;

// Mutable "live" candle state
let liveCandle: Candle | null = null;
let lastClose = BASE_PRICE;

function candleStartTime(nowSeconds: number): number {
  return nowSeconds - (nowSeconds % CANDLE_DURATION_SECONDS);
}

function startTickEngine() {
  if (tickTimer !== null) return;

  tickTimer = setInterval(() => {
    if (subscriptions.length === 0) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const candleTime = candleStartTime(nowSec);

    // ── New candle boundary ──
    if (!liveCandle || liveCandle.time !== candleTime) {
      if (liveCandle) {
        // Finalise the previous candle
        const final: Candle = { ...liveCandle, isFinal: true };
        lastClose = final.close;
        subscriptions.forEach((s) => s.onCandle(final));
      }
      liveCandle = {
        time: candleTime,
        open: round5(lastClose),
        high: round5(lastClose),
        low: round5(lastClose),
        close: round5(lastClose),
        volume: 0,
        isFinal: false,
      };
    }

    // ── Intra-candle tick ──
    const move = (Math.random() - 0.48) * TICK_MOVE;
    const newClose = round5(clamp(liveCandle.close + move));
    liveCandle = {
      ...liveCandle,
      close: newClose,
      high: round5(Math.max(liveCandle.high, newClose)),
      low: round5(Math.min(liveCandle.low, newClose)),
      volume: liveCandle.volume + Math.floor(Math.random() * 15 + 3),
      isFinal: false,
    };

    const snapshot: Candle = { ...liveCandle };
    subscriptions.forEach((s) => s.onCandle(snapshot));
  }, TICK_INTERVAL_MS);
}

function stopTickEngine() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

import { ctrader } from "@/lib/ctrader/client";

// Variables globales para la suscripción real
let isCTraderLive = false;

/**
 * Subscribe to simulated or live EURUSD tick updates.
 *
 * `onCandle` is called every ~1.5 s (mock) or on every real tick (live)
 * with the current in-progress candle (`isFinal: false`) and once more 
 * with the closed candle (`isFinal: true`) when the minute boundary rolls over.
 *
 * Returns an unsubscribe function — call it on component unmount.
 */
export function subscribeMockFeed(onCandle: (c: Candle) => void): () => void {
  // Configuración Híbrida: Intentamos usar cTrader si hay token en el .env
  const accessToken = process.env.NEXT_PUBLIC_CTRADER_ACCESS_TOKEN; // Simulación de chequeo en cliente
  
  if (accessToken && !isCTraderLive) {
    // Iniciar conexión real a cTrader
    console.log("⚡ [Feed] Modo Live cTrader detectado. Conectando al broker...");
    ctrader.connect().then(() => {
      isCTraderLive = true;
      // Autenticar la cuenta y suscribirse al símbolo
      // (Aquí irían las llamadas reales proto a authAccount y subscribeToSymbol)
      
      // Inyectar callback real
      ctrader.onTick = (symbol, bid, ask) => {
        if (symbol !== "EURUSD") return; // Filtramos
        
        const nowSec = Math.floor(Date.now() / 1000);
        const candleTime = candleStartTime(nowSec);
        
        // Cierre de vela anterior si cambió el minuto
        if (liveCandle && liveCandle.time !== candleTime) {
          const final: Candle = { ...liveCandle, isFinal: true };
          lastClose = final.close;
          onCandle(final);
          liveCandle = null;
        }

        const price = round5((bid + ask) / 2); // Precio mid simple

        if (!liveCandle) {
          liveCandle = {
            time: candleTime, open: round5(lastClose), high: Math.max(round5(lastClose), price),
            low: Math.min(round5(lastClose), price), close: price, volume: 1, isFinal: false,
          };
        } else {
          liveCandle = {
            ...liveCandle, close: price, high: Math.max(liveCandle.high, price),
            low: Math.min(liveCandle.low, price), volume: liveCandle.volume + 1, isFinal: false,
          };
        }
        
        onCandle({ ...liveCandle });
      };
    }).catch(err => console.warn("Fallo conexión cTrader, volviendo al mock:", err));
  }

  // Fallback: Mantenemos el motor mock si no hay cTrader activo
  if (subscriptions.length === 0 && liveCandle === null) {
    const seed = generateHistoricalData(1);
    if (seed.length > 0) lastClose = seed[0].close;
  }

  const sub: MockSubscription = { onCandle };
  subscriptions.push(sub);
  
  // Siempre iniciamos el motor mock por si cTrader falla o no está configurado
  if (!isCTraderLive) {
    startTickEngine();
  }

  return () => {
    subscriptions = subscriptions.filter((s) => s !== sub);
    if (subscriptions.length === 0) {
      if (!isCTraderLive) stopTickEngine();
      liveCandle = null;
    }
  };
}

/**
 * Mock 24h ticker generator for a symbol.
 */
export async function fetchMockTicker(symbol: string): Promise<Ticker24h> {
  const price = liveCandle?.close || lastClose;
  return {
    symbol,
    lastPrice: price,
    priceChange: round5(price * 0.005), // Fake 0.5% change
    priceChangePercent: 0.5,
    highPrice: round5(price * 1.01),
    lowPrice: round5(price * 0.99),
    volume: 1234567,
    quoteVolume: 1234567,
  };
}

/**
 * Mock multiple 24h tickers.
 */
export async function fetchMockTickers(symbols: string[]): Promise<Ticker24h[]> {
  return Promise.all(symbols.map((s) => fetchMockTicker(s)));
}

/**
 * Mock exchange symbols - returns a few Forex pairs.
 */
export async function fetchMockExchangeSymbols(): Promise<SymbolInfo[]> {
  const forexPairs = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"];
  return forexPairs.map((symbol) => ({
    symbol,
    baseAsset: symbol.slice(0, 3),
    quoteAsset: symbol.slice(3),
    status: "TRADING",
  }));
}

/**
 * Mock ticker subscription - periodically emits updates for symbols.
 */
export function subscribeMockTickers(
  symbols: string[],
  onTick: (s: { symbol: string; close: number; open: number; pct: number }) => void
): () => void {
  const interval = setInterval(() => {
    symbols.forEach((symbol) => {
      const price = liveCandle?.close || lastClose;
      const open = price * 0.995; // Mock open
      onTick({
        symbol,
        close: price,
        open,
        pct: 0.5,
      });
    });
  }, 2000);

  return () => clearInterval(interval);
}
