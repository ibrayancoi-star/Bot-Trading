"use client";

import { subscribeMockFeed, generateHistoricalData } from "@/lib/data/mock-feed";
import { useTradingStore } from "@/lib/store/trading-store";
import { checkRiskGuard } from "@/lib/trading/risk-guard";
import { ema } from "@/lib/indicators";
import type { Candle } from "@/lib/types/market";

let isRunnerActive = false;
let unsubscribe: (() => void) | null = null;
const FAST_EMA_PERIOD = 9;
const SLOW_EMA_PERIOD = 21;
const SYMBOL = "EURUSD"; // Hardcoded for this mockup

// Helper to calculate EMAs for the latest candle
function calculateEMAs(candles: Candle[]) {
  if (candles.length < SLOW_EMA_PERIOD) return null;
  
  const fastEmaData = ema(candles, FAST_EMA_PERIOD);
  const slowEmaData = ema(candles, SLOW_EMA_PERIOD);
  
  if (fastEmaData.length < 2 || slowEmaData.length < 2) return null;

  const currentFast = fastEmaData[fastEmaData.length - 1].value;
  const previousFast = fastEmaData[fastEmaData.length - 2].value;
  
  const currentSlow = slowEmaData[slowEmaData.length - 1].value;
  const previousSlow = slowEmaData[slowEmaData.length - 2].value;

  return { currentFast, previousFast, currentSlow, previousSlow };
}

export function startStrategyRunner() {
  if (isRunnerActive) return;
  isRunnerActive = true;

  console.log("🚀 Strategy Runner started: EMA Cross (9/21)");

  // We need historical data to compute initial EMAs accurately
  const candles = generateHistoricalData(100);

  unsubscribe = subscribeMockFeed((candle) => {
    // Update PnL for active positions immediately on every tick so RiskGuard has fresh data
    useTradingStore.setState((state) => ({
      positions: state.positions.map(p => {
        if (p.symbol === SYMBOL) {
          const pnl = p.type === "BUY" 
            ? (candle.close - p.entryPrice) * p.lotSize * 100000 
            : (p.entryPrice - candle.close) * p.lotSize * 100000;
          return { ...p, currentPrice: candle.close, pnl };
        }
        return p;
      })
    }));

    // Only evaluate logic when a candle closes to avoid intra-bar false signals
    if (!candle.isFinal) return;

    // Update our local candle history
    const lastCandle = candles[candles.length - 1];
    if (lastCandle && lastCandle.time === candle.time) {
       candles[candles.length - 1] = candle;
    } else {
       candles.push(candle);
       if (candles.length > 200) candles.shift(); // keep memory bounded
    }

    const { isBotActive, positions, addPosition, closePosition } = useTradingStore.getState();

    const emas = calculateEMAs(candles);
    if (!emas) return;

    const { currentFast, previousFast, currentSlow, previousSlow } = emas;

    // Detect Crosses
    const isBullishCross = previousFast <= previousSlow && currentFast > currentSlow;
    const isBearishCross = previousFast >= previousSlow && currentFast < currentSlow;

    if (isBullishCross || isBearishCross) {
        console.log(`\n🔔 EMA Cross Detected at ${new Date(candle.time * 1000).toLocaleTimeString()}`);
        console.log(`Fast EMA: ${currentFast.toFixed(5)}, Slow EMA: ${currentSlow.toFixed(5)}`);
        console.log(`Signal: ${isBullishCross ? "BULLISH 🟢" : "BEARISH 🔴"}`);
        console.log(`Bot Active: ${isBotActive}`);
    }

    if (!isBotActive) return;

    // 🛡️ RISK GUARD: Validar antes de abrir/cerrar posiciones automatizadas
    const riskGuard = checkRiskGuard();
    if (riskGuard.isBlocked) {
      console.warn("🛡️ " + riskGuard.reason);
      return; 
    }

    const currentPosition = positions.find((p) => p.symbol === SYMBOL);

    if (isBullishCross) {
      if (currentPosition && currentPosition.type === "SELL") {
        console.log("🤖 Bot: Solicitando cierre de SELL...");
        fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer ttp-secret-token" },
          body: JSON.stringify({
            action: "CLOSE",
            orderId: currentPosition.id,
            symbol: currentPosition.symbol,
            type: currentPosition.type,
            lotSize: currentPosition.lotSize,
            price: candle.close
          })
        }).then(res => res.json()).then(data => {
          if (data.success) {
            closePosition(currentPosition.id, {
              id: currentPosition.id,
              symbol: currentPosition.symbol,
              type: currentPosition.type,
              entryPrice: currentPosition.entryPrice,
              exitPrice: data.data.closePrice,
              lotSize: currentPosition.lotSize,
              pnl: currentPosition.pnl,
              pnlPercentage: 0,
              duration: 0,
              closedAt: data.data.timestamp,
            });
          }
        }).catch(err => console.error("Error API:", err));
      }
      
      if (!positions.some((p) => p.symbol === SYMBOL && p.type === "BUY")) {
        console.log("🤖 Bot: Solicitando BUY...");
        fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer ttp-secret-token" },
          body: JSON.stringify({
            action: "OPEN",
            symbol: SYMBOL,
            type: "BUY",
            lotSize: 1.0,
            price: candle.close
          })
        }).then(res => res.json()).then(data => {
          if (data.success) {
            addPosition({
              id: data.data.orderId,
              symbol: data.data.symbol,
              type: data.data.type,
              lotSize: data.data.lotSize,
              entryPrice: data.data.executionPrice,
              currentPrice: data.data.executionPrice,
              pnl: 0,
            });
          }
        }).catch(err => console.error("Error API:", err));
      }
    } else if (isBearishCross) {
      if (currentPosition && currentPosition.type === "BUY") {
        console.log("🤖 Bot: Solicitando cierre de BUY...");
        fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer ttp-secret-token" },
          body: JSON.stringify({
            action: "CLOSE",
            orderId: currentPosition.id,
            symbol: currentPosition.symbol,
            type: currentPosition.type,
            lotSize: currentPosition.lotSize,
            price: candle.close
          })
        }).then(res => res.json()).then(data => {
          if (data.success) {
            closePosition(currentPosition.id, {
              id: currentPosition.id,
              symbol: currentPosition.symbol,
              type: currentPosition.type,
              entryPrice: currentPosition.entryPrice,
              exitPrice: data.data.closePrice,
              lotSize: currentPosition.lotSize,
              pnl: currentPosition.pnl,
              pnlPercentage: 0,
              duration: 0,
              closedAt: data.data.timestamp,
            });
          }
        }).catch(err => console.error("Error API:", err));
      }
      
      if (!positions.some((p) => p.symbol === SYMBOL && p.type === "SELL")) {
         console.log("🤖 Bot: Solicitando SELL...");
         fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer ttp-secret-token" },
          body: JSON.stringify({
            action: "OPEN",
            symbol: SYMBOL,
            type: "SELL",
            lotSize: 1.0,
            price: candle.close
          })
        }).then(res => res.json()).then(data => {
          if (data.success) {
            addPosition({
              id: data.data.orderId,
              symbol: data.data.symbol,
              type: data.data.type,
              lotSize: data.data.lotSize,
              entryPrice: data.data.executionPrice,
              currentPrice: data.data.executionPrice,
              pnl: 0,
            });
          }
        }).catch(err => console.error("Error API:", err));
      }
    }

  });
}

export function stopStrategyRunner() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  isRunnerActive = false;
  console.log("🛑 Strategy Runner stopped");
}
