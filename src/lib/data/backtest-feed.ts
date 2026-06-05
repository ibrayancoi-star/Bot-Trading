"use client";

import { useBacktestStore, type BacktestTrade } from "../store/backtest-store";

function getSocket(): WebSocket | null {
  if (typeof window !== "undefined") {
    return (window as any).__mt5_bridge_state__?.localSocket || null;
  }
  return null;
}

export function handleBacktestMessage(data: any) {
  const store = useBacktestStore.getState();

  switch (data.type) {
    case "backtest_candle":
      if (data.data) {
        store.appendCandle(data.data);
      }
      break;

    case "backtest_trade":
      if (data.data) {
        store.addOrUpdateTrade(data.data as BacktestTrade);
      }
      break;

    case "backtest_equity":
      if (data.data) {
        store.appendEquityPoint(data.data);
      }
      break;

    case "backtest_progress":
      if (data.data) {
        store.setProgress(data.data.current, data.data.total);
      }
      break;

    case "backtest_done":
      store.setStatus("completed");
      store.setIsRunning(false);
      if (data.data) {
        store.setMetrics(data.data);
      }
      break;

    case "backtest_error":
      store.setError(data.message || "Error desconocido en backtest");
      break;

    default:
      console.warn("Mensaje de backtest desconocido:", data);
  }
}

export function startBacktest(params: {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  config: any;
}) {
  const ws = getSocket();
  if (ws && ws.readyState === WebSocket.OPEN) {
    useBacktestStore.getState().clearBacktest();
    useBacktestStore.getState().setStatus("running");
    useBacktestStore.getState().setIsRunning(true);

    ws.send(JSON.stringify({
      type: "backtest_start",
      params
    }));
    console.log("📤 [Backtest Feed] Iniciando backtest:", params);
  } else {
    console.error("⚠️ WebSocket no conectado.");
    useBacktestStore.getState().setError("MetaTrader 5 Bridge no conectado. Ejecuta `mt5_bridge.py` primero.");
  }
}

export function stopBacktest() {
  const ws = getSocket();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "backtest_stop"
    }));
    useBacktestStore.getState().setIsRunning(false);
    useBacktestStore.getState().setStatus("idle");
    console.log("📤 [Backtest Feed] Solicitando parada de backtest");
  }
}
