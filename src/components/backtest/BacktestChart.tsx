"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useBacktestStore } from "@/lib/store/backtest-store";

interface Props {
  symbol: string;
}

const TV_COLORS = {
  bg: "#131722",
  panel: "#1e222d",
  border: "#2a2e39",
  text: "#d1d4dc",
  textMuted: "#787b86",
  green: "#26a69a",
  red: "#ef5350",
  blue: "#2962ff",
  grid: "#1e222d",
};

export function BacktestChart({ symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const { candles, trades } = useBacktestStore();

  // Initialize Chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: TV_COLORS.bg },
        textColor: TV_COLORS.text,
        fontFamily: "var(--font-sans), Inter, system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: TV_COLORS.grid },
        horzLines: { color: TV_COLORS.grid },
      },
      rightPriceScale: {
        borderColor: TV_COLORS.border,
        textColor: TV_COLORS.textMuted,
      },
      timeScale: {
        borderColor: TV_COLORS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: TV_COLORS.green,
      downColor: TV_COLORS.red,
      borderUpColor: TV_COLORS.green,
      borderDownColor: TV_COLORS.red,
      wickUpColor: TV_COLORS.green,
      wickDownColor: TV_COLORS.red,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, []);

  // Update Candles
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;
    
    const formatted = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeriesRef.current.setData(formatted);
  }, [candles]);

  // Update Trade Markers
  useEffect(() => {
    if (!candleSeriesRef.current || trades.length === 0 || candles.length === 0) return;

    const markers: any[] = [];
    trades.forEach((t) => {
      // Entry marker
      markers.push({
        time: t.time as UTCTimestamp,
        position: t.type === "buy" ? "belowBar" : "aboveBar",
        color: t.type === "buy" ? "#34d399" : "#f87171",
        shape: t.type === "buy" ? "arrowUp" : "arrowDown",
        text: `${t.type.toUpperCase()} L:${t.volume}`,
      });

      // Exit marker
      if (t.close_time && t.close_price) {
        markers.push({
          time: t.close_time as UTCTimestamp,
          position: t.type === "buy" ? "aboveBar" : "belowBar",
          color: (t.pnl || 0) > 0 ? "#10b981" : "#ef4444",
          shape: "circle",
          text: `CLOSE PnL:${t.pnl?.toFixed(1)}`,
        });
      }
    });

    // Sort markers chronologically to avoid lightweight charts warning/error
    markers.sort((a, b) => a.time - b.time);
    
    candleSeriesRef.current.setMarkers(markers);
  }, [trades, candles]);

  return (
    <div className="relative flex-1 bg-zinc-950 min-h-0 border-b border-tv-border">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
