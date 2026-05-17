import type { Candle, Ticker24h, SymbolInfo } from "@/lib/types/market";
import { useChartStore } from "../store/chart-store";
import { useTradingStore } from "../store/trading-store";

const CANDLE_DURATION_SECONDS = 60; // 1-minute candles
const TICK_INTERVAL_MS = 1500; // emit a tick every 1.5 s

function getSymbolParams(symbol: string) {
  const isJPY = symbol.includes("JPY");
  let basePrice = 1.08500;
  let priceMin = 1.00000;
  let priceMax = 1.20000;
  let tickMove = 0.00025;
  let candleMove = 0.0008;

  if (symbol === "GBPUSD") {
    basePrice = 1.25200;
    priceMin = 1.15000;
    priceMax = 1.35000;
  } else if (symbol === "USDJPY") {
    basePrice = 155.80;
    priceMin = 145.00;
    priceMax = 165.00;
    tickMove = 0.025;
    candleMove = 0.08;
  } else if (symbol === "USDCHF") {
    basePrice = 0.90200;
    priceMin = 0.85000;
    priceMax = 0.95000;
  } else if (symbol === "AUDUSD") {
    basePrice = 0.66500;
    priceMin = 0.60000;
    priceMax = 0.75000;
  } else if (symbol === "USDCAD") {
    basePrice = 1.36500;
    priceMin = 1.30000;
    priceMax = 1.45000;
  } else if (symbol === "NZDUSD") {
    basePrice = 0.60500;
    priceMin = 0.55000;
    priceMax = 0.68000;
  } else if (symbol === "EURGBP") {
    basePrice = 0.85600;
    priceMin = 0.80000;
    priceMax = 0.92000;
  } else if (symbol === "EURJPY") {
    basePrice = 169.20;
    priceMin = 160.00;
    priceMax = 180.00;
    tickMove = 0.025;
    candleMove = 0.08;
  } else if (symbol === "GBPJPY") {
    basePrice = 195.50;
    priceMin = 185.00;
    priceMax = 205.00;
    tickMove = 0.025;
    candleMove = 0.08;
  }

  return { isJPY, basePrice, priceMin, priceMax, tickMove, candleMove };
}

function roundPrice(n: number, isJPY: boolean): number {
  return parseFloat(n.toFixed(isJPY ? 3 : 5));
}

function round5(n: number): number {
  const symbol = typeof window !== "undefined" ? useChartStore.getState().symbol : "EURUSD";
  return roundPrice(n, symbol.includes("JPY"));
}

function clampPrice(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildCandle(time: number, open: number, symbol: string): Candle {
  const { isJPY, priceMin, priceMax, candleMove } = getSymbolParams(symbol);
  const drift = (Math.random() - 0.47) * candleMove; // slight bull bias
  const close = roundPrice(clampPrice(open + drift, priceMin, priceMax), isJPY);
  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);
  const high = roundPrice(clampPrice(bodyHigh + Math.random() * candleMove * 0.6, priceMin, priceMax), isJPY);
  const low = roundPrice(clampPrice(bodyLow - Math.random() * candleMove * 0.6, priceMin, priceMax), isJPY);
  const volume = Math.floor(Math.random() * 600 + 200);
  return { time, open: roundPrice(open, isJPY), high, low, close, volume, isFinal: true };
}

export function generateHistoricalData(count: number): Candle[] {
  const candles: Candle[] = [];
  const now = Math.floor(Date.now() / 1000);
  // Align to the last completed minute boundary
  const latestClose = now - (now % CANDLE_DURATION_SECONDS);
  const startTime = latestClose - count * CANDLE_DURATION_SECONDS;

  const symbol = typeof window !== "undefined" ? useChartStore.getState().symbol : "EURUSD";
  const { isJPY, basePrice } = getSymbolParams(symbol);

  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const time = startTime + i * CANDLE_DURATION_SECONDS;
    const c = buildCandle(time, price, symbol);
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
let lastClose = 1.08500;

function candleStartTime(nowSeconds: number): number {
  return nowSeconds - (nowSeconds % CANDLE_DURATION_SECONDS);
}

function startTickEngine() {
  if (tickTimer !== null) return;

  tickTimer = setInterval(() => {
    if (subscriptions.length === 0) return;
    
    // Si la conexión real con MT5 está activa, no generamos ticks simulados
    if (isBridgeLive) return;

    const symbol = typeof window !== "undefined" ? useChartStore.getState().symbol : "EURUSD";
    const { isJPY, priceMin, priceMax, tickMove } = getSymbolParams(symbol);

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
      // Asegurarse de que lastClose se ajusta al rango del nuevo símbolo
      const currentParams = getSymbolParams(symbol);
      if (lastClose < currentParams.priceMin || lastClose > currentParams.priceMax) {
        lastClose = currentParams.basePrice;
      }

      liveCandle = {
        time: candleTime,
        open: roundPrice(lastClose, isJPY),
        high: roundPrice(lastClose, isJPY),
        low: roundPrice(lastClose, isJPY),
        close: roundPrice(lastClose, isJPY),
        volume: 0,
        isFinal: false,
      };
    }

    // ── Intra-candle tick ──
    const move = (Math.random() - 0.48) * tickMove;
    const newClose = roundPrice(clampPrice(liveCandle.close + move, priceMin, priceMax), isJPY);
    liveCandle = {
      ...liveCandle,
      close: newClose,
      high: roundPrice(Math.max(liveCandle.high, newClose), isJPY),
      low: roundPrice(Math.min(liveCandle.low, newClose), isJPY),
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

// Variables globales para la conexión WebSocket con el puente MT5 de Python
let localSocket: WebSocket | null = null;
let isBridgeConnecting = false;
let isBridgeLive = false;

// Callbacks para despachar ticks al suscriptor activo
let activeOnCandleCallback: ((c: Candle) => void) | null = null;

function connectLocalMT5Bridge() {
  if (localSocket || isBridgeConnecting) return;
  isBridgeConnecting = true;

  useTradingStore.setState({ connection: { status: "connecting" } });
  console.log("🔌 [MT5 Bridge] Conectando a ws://127.0.0.1:8000...");

  const socket = new WebSocket("ws://127.0.0.1:8000");

  socket.onopen = () => {
    console.log("✅ [MT5 Bridge] Conectado exitosamente al puente de Python.");
    localSocket = socket;
    isBridgeConnecting = false;
    isBridgeLive = true;

    useTradingStore.setState({
      connection: {
        status: "connected",
        lastSync: Date.now(),
      },
    });
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "account") {
        // Sincronizar datos financieros de la cuenta en el store global
        useTradingStore.setState({
          account: {
            balance: data.balance,
            equity: data.equity,
            dailyDrawdownLimit: data.balance * 0.05, // 5% Drawdown
            maxDrawdownLimit: data.balance * 0.10, // 10% Drawdown
            profitTarget: data.balance * 0.08, // 8% Target
            status: data.status === "failed" ? "failed" : "active",
          },
          connection: {
            status: "connected",
            lastSync: Date.now(),
            error: undefined
          }
        });
      } else if (data.type === "tick") {
        const { symbol, bid, ask } = data;
        const currentSymbol = useChartStore.getState().symbol;

        // Si el tick recibido coincide con el activo en pantalla
        if (symbol === currentSymbol && activeOnCandleCallback) {
          const nowSec = Math.floor(Date.now() / 1000);
          const candleTime = candleStartTime(nowSec);
          const price = round5((bid + ask) / 2); // Precio medio (Mid)

          // Cierre de vela anterior si cambió el minuto
          if (liveCandle && liveCandle.time !== candleTime) {
            const final: Candle = { ...liveCandle, isFinal: true };
            lastClose = final.close;
            activeOnCandleCallback(final);
            liveCandle = null;
          }

          if (!liveCandle) {
            // Transición suave: Si venimos de datos simulados y el precio real es muy diferente,
            // forzamos el precio de apertura al precio real actual.
            const isSimulatedJump = Math.abs(lastClose - price) > (symbol.includes("JPY") ? 5.0 : 0.01);
            const openPrice = isSimulatedJump ? price : round5(lastClose);

            liveCandle = {
              time: candleTime,
              open: openPrice,
              high: Math.max(openPrice, price),
              low: Math.min(openPrice, price),
              close: price,
              volume: 1,
              isFinal: false,
            };
          } else {
            liveCandle = {
              ...liveCandle,
              close: price,
              high: Math.max(liveCandle.high, price),
              low: Math.min(liveCandle.low, price),
              volume: liveCandle.volume + 1,
              isFinal: false,
            };
          }

          activeOnCandleCallback({ ...liveCandle });
        }
      }
    } catch (err) {
      console.error("❌ [MT5 Bridge] Error al parsear mensaje:", err);
    }
  };

  socket.onerror = (error) => {
    console.error("🚨 [MT5 Bridge] Error en WebSocket:", error);
  };

  socket.onclose = () => {
    console.warn("🛑 [MT5 Bridge] Conexión cerrada. Intentando reconectar en 3s...");
    localSocket = null;
    isBridgeConnecting = false;
    isBridgeLive = false;

    useTradingStore.setState({
      connection: {
        status: "disconnected",
        error: "Puente local de Python inactivo",
      },
    });

    setTimeout(connectLocalMT5Bridge, 3000);
  };
}

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
  // Guardamos el callback activo para despachar los ticks reales de MT5
  activeOnCandleCallback = onCandle;

  // Intentamos conectar automáticamente al puente de Python (MT5)
  if (typeof window !== "undefined") {
    connectLocalMT5Bridge();
  }

  // Si no hay suscripciones activas, inicializamos los valores de semilla
  if (subscriptions.length === 0 && liveCandle === null) {
    const seed = generateHistoricalData(1);
    if (seed.length > 0) lastClose = seed[0].close;
  }

  const sub: MockSubscription = { onCandle };
  subscriptions.push(sub);
  
  // Siempre iniciamos el motor mock como contingencia/fallback
  // Pero el callback de WebSocket MT5 lo pisará en tiempo real si el puente está activo
  startTickEngine();

  return () => {
    subscriptions = subscriptions.filter((s) => s !== sub);
    if (subscriptions.length === 0) {
      stopTickEngine();
      liveCandle = null;
      activeOnCandleCallback = null;
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
