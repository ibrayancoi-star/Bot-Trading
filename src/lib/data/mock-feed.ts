import type { Candle, Ticker24h, SymbolInfo } from "@/lib/types/market";
import { useChartStore } from "../store/chart-store";
import { useTradingStore } from "../store/trading-store";
import { handleBacktestMessage } from "./backtest-feed";


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

function getTimeframeSeconds(tf: string): number {
  switch (tf) {
    case "1m": return 60;
    case "3m": return 180;
    case "5m": return 300;
    case "15m": return 900;
    case "30m": return 1800;
    case "1h": return 3600;
    case "2h": return 7200;
    case "4h": return 14400;
    case "6h": return 21600;
    case "8h": return 28800;
    case "12h": return 43200;
    case "1d": return 86400;
    case "3d": return 259200;
    case "1w": return 604800;
    case "1M": return 2592000;
    default: return 60;
  }
}

export function generateHistoricalData(count: number): Candle[] {
  const candles: Candle[] = [];
  const now = Math.floor(Date.now() / 1000);
  const tf = typeof window !== "undefined" ? useChartStore.getState().timeframe : "1m";
  const duration = getTimeframeSeconds(tf);
  // Align to the last completed boundary for the active timeframe
  const latestClose = now - (now % duration);
  const startTime = latestClose - count * duration;

  const symbol = typeof window !== "undefined" ? useChartStore.getState().symbol : "EURUSD";
  const { isJPY, basePrice } = getSymbolParams(symbol);

  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const time = startTime + i * duration;
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
  const tf = typeof window !== "undefined" ? useChartStore.getState().timeframe : "1m";
  const duration = getTimeframeSeconds(tf);
  return nowSeconds - (nowSeconds % duration);
}

function startTickEngine() {
  if (tickTimer !== null) return;

  tickTimer = setInterval(() => {
    if (subscriptions.length === 0) return;

    // Si la conexión real con MT5 está activa, no generamos ticks simulados
    if (bridgeState.isBridgeLive) return;

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
const g = typeof window !== "undefined" ? (window as any) : {} as any;

if (!g.__mt5_bridge_state__) {
  g.__mt5_bridge_state__ = {
    localSocket: null,
    isBridgeConnecting: false,
    isBridgeLive: false,
    chartStoreSubscribed: false,
    tradingStoreSubscribed: false
  };
}

const bridgeState = g.__mt5_bridge_state__;

// Callbacks para despachar ticks y el historial al suscriptor activo
let activeOnCandleCallback: ((c: Candle) => void) | null = null;
let activeOnHistoryCallback: ((history: Candle[]) => void) | null = null;

// [FIX PING-PONG] — Bloquea el subscriber durante sincronización desde bridge
let _syncingFromBridge = false;

export function requestHistoryFromBridge(symbol: string, timeframe: string) {
  if (bridgeState.localSocket && bridgeState.localSocket.readyState === WebSocket.OPEN) {
    const msg = {
      action: "request_history",
      symbol: symbol,
      timeframe,
    };
    bridgeState.localSocket.send(JSON.stringify(msg));
    console.log(`📤 [MT5 Bridge] Solicitando historial para ${msg.symbol} (${msg.timeframe})`);
  } else {
    console.warn("⚠️ [MT5 Bridge] WebSocket no listo para solicitar historial.");
  }
}

export function sendTradeOrder(symbol: string, type: "buy" | "sell", volume: number, tp: number = 0, sl: number = 0) {
  if (bridgeState.localSocket && bridgeState.localSocket.readyState === WebSocket.OPEN) {
    const msg = {
      action: type,
      symbol,
      volume,
      tp,
      sl
    };
    bridgeState.localSocket.send(JSON.stringify(msg));
    console.log(`📤 [MT5 Bridge] Enviando orden de ${type.toUpperCase()} para ${symbol} (${volume} lotes)`);
  } else {
    console.warn("⚠️ [MT5 Bridge] WebSocket no listo para enviar orden.");
  }
}

export function modifyPosition(ticket: number, tp: number, sl: number) {
  if (bridgeState.localSocket && bridgeState.localSocket.readyState === WebSocket.OPEN) {
    const msg = {
      action: "modify_position",
      ticket,
      tp,
      sl
    };
    bridgeState.localSocket.send(JSON.stringify(msg));
    console.log(`📤 [MT5 Bridge] Modificando posición ${ticket} (TP: ${tp}, SL: ${sl})`);
  } else {
    console.warn("⚠️ [MT5 Bridge] WebSocket no listo para modificar orden.");
  }
}

export function closePositionOnBridge(ticket: number) {
  if (bridgeState.localSocket && bridgeState.localSocket.readyState === WebSocket.OPEN) {
    const msg = {
      action: "close_position",
      ticket,
    };
    bridgeState.localSocket.send(JSON.stringify(msg));
    console.log(`📤 [MT5 Bridge] Solicitando cierre de posición ${ticket}`);
  } else {
    console.warn("⚠️ [MT5 Bridge] WebSocket no listo para cerrar posición.");
  }
}

// [POSITIONS MODULE]
export function sendClosePosition(ticket: number) {
  if (bridgeState.localSocket && bridgeState.localSocket.readyState === WebSocket.OPEN) {
    const msg = { action: "close_position", ticket };
    bridgeState.localSocket.send(JSON.stringify(msg));
    console.log(`📤 [MT5 Bridge] Solicitando cierre de posición #${ticket}`);
  }
}

export function sendBotConfig(config: any) {
  if (bridgeState.localSocket && bridgeState.localSocket.readyState === WebSocket.OPEN) {
    bridgeState.localSocket.send(JSON.stringify({
      action: "BOT_CONFIG_UPDATE",
      payload: config
    }));
    console.log("📤 [MT5 Bridge] Enviando actualización de configuración de bot:", config);
  } else {
    console.warn("⚠️ [MT5 Bridge] WebSocket no listo para enviar configuración del bot.");
  }
}

// Suscribir el WebSocket a Zustand de manera global (se ejecuta una sola vez)
if (typeof window !== "undefined") {
  if (!bridgeState.chartStoreSubscribed) {
    bridgeState.chartStoreSubscribed = true;
    let lastTimeframe = useChartStore.getState().timeframe;
    let lastSymbol = useChartStore.getState().symbol;
    useChartStore.subscribe((state) => {
      if (state.timeframe !== lastTimeframe || state.symbol !== lastSymbol) {
        const prevTf = lastTimeframe;
        const prevSym = lastSymbol;
        lastTimeframe = state.timeframe;
        lastSymbol = state.symbol;
        if (bridgeState.localSocket && bridgeState.localSocket.readyState === WebSocket.OPEN) {
          console.log(`📡 [Zustand Sync] Cambio detectado: ${prevSym} ${prevTf} -> ${state.symbol} ${state.timeframe}. Solicitando historial a MT5...`);
          bridgeState.localSocket.send(JSON.stringify({
            action: "request_history",
            symbol: state.symbol,
            timeframe: state.timeframe
          }));
        }
      }
    });
  }

  if (!bridgeState.tradingStoreSubscribed) {
    bridgeState.tradingStoreSubscribed = true;
    let lastBotActive = useTradingStore.getState().isBotActive;
    let lastBotSymbols = useTradingStore.getState().botActiveSymbols;
    useTradingStore.subscribe((state) => {
      // [FIX PING-PONG] — Si el cambio viene del bridge, no reenviar
      if (_syncingFromBridge) return;
      const symbolsChanged = JSON.stringify(state.botActiveSymbols) !== JSON.stringify(lastBotSymbols);
      if (state.isBotActive !== lastBotActive || symbolsChanged) {
        lastBotActive = state.isBotActive;
        lastBotSymbols = state.botActiveSymbols;
        if (bridgeState.localSocket && bridgeState.localSocket.readyState === WebSocket.OPEN) {
          console.log(`📡 [Zustand Sync] Cambio de estado de bot detectado. Enviando a MT5...`);
          bridgeState.localSocket.send(JSON.stringify({
            action: "toggle_bot",
            active: state.isBotActive,
            symbols: state.botActiveSymbols
          }));
        }
      }
    });
  }
}

function connectLocalMT5Bridge() {
  if (bridgeState.localSocket || bridgeState.isBridgeConnecting) return;
  bridgeState.isBridgeConnecting = true;

  useTradingStore.setState({ connection: { status: "connecting" } });
  console.log("🔌 [MT5 Bridge] Conectando a ws://127.0.0.1:8000...");

  const socket = new WebSocket("ws://127.0.0.1:8000");

  socket.onopen = () => {
    console.log("✅ [MT5 Bridge] Conectado exitosamente al puente de Python.");
    bridgeState.localSocket = socket;
    bridgeState.isBridgeConnecting = false;
    bridgeState.isBridgeLive = true;

    useTradingStore.setState({
      connection: {
        status: "connected",
        lastSync: Date.now(),
      },
    });

    // Petición de historial inicial en la conexión (Cold Start)
    const currentState = useChartStore.getState();
    console.log(`📡 [MT5 Bridge] Petición inicial de historial (Cold Start) para: ${currentState.symbol} ${currentState.timeframe}`);
    socket.send(JSON.stringify({
      action: "request_history",
      symbol: currentState.symbol,
      timeframe: currentState.timeframe
    }));
    // [FIX PING-PONG] — NO enviamos toggle_bot aquí.
    // Python enviará bot_status con su estado real al conectar.

    // Sincronizar configuración inicial del bot
    const currentBotConfig = useTradingStore.getState().botConfig;
    if (currentBotConfig) {
      socket.send(JSON.stringify({
        action: "BOT_CONFIG_UPDATE",
        payload: currentBotConfig
      }));
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (typeof data.type === "string" && data.type.startsWith("backtest_")) {
        handleBacktestMessage(data);
        return;
      }

      if (data.type === "bot_status") {
        const currentStore = useTradingStore.getState();
        if (currentStore.isBotActive !== data.active) {
          _syncingFromBridge = true;
          try {
            useTradingStore.setState({ isBotActive: data.active });
          } finally {
            _syncingFromBridge = false;
          }
        }
      } else if (data.type === "account") {
        const currentStore = useTradingStore.getState();

        // Check if we have a manually assigned type for this account
        const accountKey = `${data.server}_${data.login}`;
        const knownAccount = currentStore.knownAccounts[accountKey];

        // Use manually set type if exists, otherwise fallback to bridge's autodetection
        let targetType: "real" | "fondeo" | "demo" = knownAccount?.type || (data.account_type || "real");

        // Solo cambiamos automáticamente de pestaña en el frontend si es la primera vez
        // que nos conectamos o si el usuario cambia físicamente de cuenta en MetaTrader 5.
        const isNewAccount = !currentStore.account.login ||
          currentStore.account.login !== data.login ||
          currentStore.account.server !== data.server;

        // Register the account if it's entirely new to our persistence
        if (!knownAccount && data.login && data.server) {
          currentStore.registerKnownAccount(data.login, data.server, targetType);
        }

        // Sincronizar datos financieros de la cuenta en el store global
        useTradingStore.setState({
          accountType: targetType,
          algoTradingEnabled: data.algo_trading === true,
          account: {
            balance: data.balance,
            equity: data.equity,
            dailyDrawdownLimit: data.balance * 0.05, // 5% Drawdown
            maxDrawdownLimit: data.balance * 0.10, // 10% Drawdown
            profitTarget: data.balance * 0.08, // 8% Target
            status: data.status === "failed" ? "failed" : "active",
            server: data.server,
            login: data.login
          },
          connection: {
            status: "connected",
            lastSync: Date.now(),
            error: undefined
          }
        });
      } else if (data.type === "trade_result") {
        // Feedback de resultado de operación desde el puente MT5
        const store = useTradingStore.getState();
        if (data.success) {
          store.addNotification("success", data.message || "Operación ejecutada.");
        } else {
          store.addNotification("error", data.error || "Error desconocido.");
        }
      } else if (data.type === "positions") {
        // [POSITIONS MODULE] Mapeo de posiciones vivas
        const positions = data.data.map((p: any) => ({
          ticket:        p.ticket,
          symbol:        p.symbol,
          type:          p.type.toLowerCase(),
          volume:        p.volume,
          open_price:    p.open_price,
          current_price: p.current_price || p.open_price,
          sl:            p.sl || 0,
          tp:            p.tp || 0,
          profit:        p.profit || 0,
          time:          p.time || Date.now(),
        }));
        useTradingStore.getState().setPositions(positions);

      } else if (data.type === "history") {
        const { symbol, timeframe, data: candles } = data;
        console.log(`📥 [MT5 Bridge] Recibido historial de ${candles.length} velas para ${symbol} (${timeframe})`);

        if (candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          lastClose = lastCandle.close;
          liveCandle = {
            ...lastCandle,
            isFinal: false // La marcamos como no finalizada para recibir actualizaciones de ticks en ella
          };
        }

        if (activeOnHistoryCallback) {
          activeOnHistoryCallback(candles);
        }
      } else if (data.type === "tick") {
        const { symbol, bid, ask, time, indicators } = data;
        const currentSymbol = useChartStore.getState().symbol;

        // Si el tick recibido coincide con el activo en pantalla
        if (symbol === currentSymbol && activeOnCandleCallback) {
          // Usar el tiempo del servidor MT5 enviado en el tick si existe, si no, fallback a local
          const nowSec = time ? time : Math.floor(Date.now() / 1000);
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
              indicators,
            };
          } else {
            liveCandle = {
              ...liveCandle,
              close: price,
              high: Math.max(liveCandle.high, price),
              low: Math.min(liveCandle.low, price),
              volume: liveCandle.volume + 1,
              isFinal: false,
              indicators,
            };
          }

          activeOnCandleCallback({ ...liveCandle });
        }
      } else if (data.type === "history_init") {
        // [POSITIONS MODULE] Historial de MT5 (no de Chroma)
        const normalized = (data.trades || []).map((t: any) => ({
          ticket:      t.ticket      ?? t.order      ?? t.id,
          symbol:      t.symbol      ?? t.instrument ?? "—",
          type:        ((t.type ?? t.order_type ?? "buy") as string).toLowerCase() as "buy" | "sell",
          volume:      t.volume      ?? t.lots       ?? 0,
          open_price:  t.open_price  ?? t.price_open ?? 0,
          close_price: t.close_price ?? t.price_close?? 0,
          sl:          t.sl || 0,
          tp:          t.tp || 0,
          profit:      t.profit || 0,
          pnl:         t.pnl         ?? t.profit     ?? 0,
          time:        t.time,
          close_time:  t.close_time  ?? t.time_close ?? t.time ?? 0,
        }));
        useTradingStore.getState().initHistory(normalized);
      } else if (data.type === "history_update") {
        // [POSITIONS MODULE] Nueva operación cerrada desde MT5
        const t = data.trade || {};
        const trade = {
          ticket:      t.ticket      ?? t.order      ?? t.id,
          symbol:      t.symbol      ?? t.instrument ?? "—",
          type:        ((t.type ?? t.order_type ?? "buy") as string).toLowerCase() as "buy" | "sell",
          volume:      t.volume      ?? t.lots       ?? 0,
          open_price:  t.open_price  ?? t.price_open ?? 0,
          close_price: t.close_price ?? t.price_close?? 0,
          sl:          t.sl || 0,
          tp:          t.tp || 0,
          profit:      t.profit || 0,
          pnl:         t.pnl         ?? t.profit     ?? 0,
          time:        t.time || Date.now(),
          close_time:  t.close_time  ?? t.time_close ?? t.time ?? Date.now()
        };
        useTradingStore.getState().appendHistory(trade as any);
      }
    } catch (err) {
      console.error("❌ [MT5 Bridge] Error al parsear mensaje:", err);
    }
  };

  socket.onerror = (error) => {
    console.error("🚨 [MT5 Bridge] Error de conexión en WebSocket. Asegúrate de que `mt5_bridge.py` esté ejecutándose en ws://127.0.0.1:8000", error);
  };

  socket.onclose = () => {
    console.warn("🛑 [MT5 Bridge] Conexión cerrada. Intentando reconectar en 3s...");
    bridgeState.localSocket = null;
    bridgeState.isBridgeConnecting = false;
    bridgeState.isBridgeLive = false;

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
export function subscribeMockFeed(
  onCandle: (c: Candle) => void,
  onHistory?: (history: Candle[]) => void
): () => void {
  // Guardamos los callbacks activos para despachar ticks e historial
  activeOnCandleCallback = onCandle;
  if (onHistory) {
    activeOnHistoryCallback = onHistory;
  }

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
      // NOTA: No anulamos activeOnHistoryCallback aquí.
      // El WebSocket es un singleton global que vive fuera del ciclo de React.
      // Si lo anulamos, las respuestas de historial se pierden durante
      // la transición de cleanup/re-subscribe del useEffect.
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
