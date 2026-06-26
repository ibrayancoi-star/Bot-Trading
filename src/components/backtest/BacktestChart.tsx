"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, LineStyle, type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp } from "lightweight-charts";
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
  const { candles, trades, anchorRange, dailyRange, timeframe } = useBacktestStore();

  // Refs de las líneas de rango CRT (mismo estilo que el chart del demo)
  const dailyHighLineRef = useRef<IPriceLine | null>(null);
  const dailyLowLineRef = useRef<IPriceLine | null>(null);
  const anchorHighLineRef = useRef<IPriceLine | null>(null);
  const anchorLowLineRef = useRef<IPriceLine | null>(null);
  const anchorEqLineRef = useRef<IPriceLine | null>(null);

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

  // Guarda de render: último time escrito en la serie, TF previa y longitud previa.
  const lastTimeRef = useRef<number | null>(null);
  const prevTfRef = useRef<string | null>(null);
  const prevLenRef = useRef<number>(0);

  const fmt = (c: any) => ({
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  });

  // Render de velas robusto (anima el forming + navega TF + nunca crashea con "oldest data").
  //  - update() SOLO cuando es seguro: misma TF, longitud crece ≤1 y el time no retrocede.
  //    Eso anima la vela en formación y los appends conservando zoom/scroll.
  //  - setData() en cualquier otro caso (cambio de TF, primer pintado, batch, no-monotonía).
  //    fitContent() solo al cambiar de TF o en el primer pintado (no resetea el zoom durante el stream).
  useEffect(() => {
    const series = candleSeriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    if (candles.length === 0) {
      series.setData([]);
      lastTimeRef.current = null;
      prevTfRef.current = timeframe;
      prevLenRef.current = 0;
      return;
    }

    const last = candles[candles.length - 1];
    const lastT = last.time as number;
    const tfChanged = prevTfRef.current !== timeframe;
    const grewByOne = candles.length === prevLenRef.current
                   || candles.length === prevLenRef.current + 1;
    const canUpdate = !tfChanged
                   && lastTimeRef.current !== null
                   && grewByOne
                   && lastT >= lastTimeRef.current;

    if (canUpdate) {
      series.update(fmt(last));
    } else {
      series.setData(candles.map(fmt));
      if (tfChanged || lastTimeRef.current === null) {
        try { chart.timeScale().fitContent(); } catch {}
      }
    }

    lastTimeRef.current = lastT;
    prevTfRef.current = timeframe;
    prevLenRef.current = candles.length;
  }, [candles, timeframe]);

  // [RANGO D1] líneas de contexto (mismo estilo que el demo)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    if (dailyHighLineRef.current) { try { series.removePriceLine(dailyHighLineRef.current); } catch {} dailyHighLineRef.current = null; }
    if (dailyLowLineRef.current) { try { series.removePriceLine(dailyLowLineRef.current); } catch {} dailyLowLineRef.current = null; }
    if (!dailyRange) return;
    dailyHighLineRef.current = series.createPriceLine({
      price: dailyRange.high, color: "#22c55e", lineStyle: LineStyle.Dashed, lineWidth: 1,
      title: "D1 High", axisLabelVisible: true,
    });
    dailyLowLineRef.current = series.createPriceLine({
      price: dailyRange.low, color: "#ef4444", lineStyle: LineStyle.Dashed, lineWidth: 1,
      title: "D1 Low", axisLabelVisible: true,
    });
  }, [dailyRange]);

  // [RANGO H4] rango operativo CRT High/Low/EQ (mismo estilo que el demo)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    if (anchorHighLineRef.current) { try { series.removePriceLine(anchorHighLineRef.current); } catch {} anchorHighLineRef.current = null; }
    if (anchorLowLineRef.current) { try { series.removePriceLine(anchorLowLineRef.current); } catch {} anchorLowLineRef.current = null; }
    if (anchorEqLineRef.current) { try { series.removePriceLine(anchorEqLineRef.current); } catch {} anchorEqLineRef.current = null; }
    if (!anchorRange) return;
    anchorHighLineRef.current = series.createPriceLine({
      price: anchorRange.high, color: "#3b82f6", lineStyle: LineStyle.Solid, lineWidth: 2,
      title: "CRT H", axisLabelVisible: true,
    });
    anchorLowLineRef.current = series.createPriceLine({
      price: anchorRange.low, color: "#3b82f6", lineStyle: LineStyle.Solid, lineWidth: 2,
      title: "CRT L", axisLabelVisible: true,
    });
    anchorEqLineRef.current = series.createPriceLine({
      price: anchorRange.eq, color: "#eab308", lineStyle: LineStyle.SparseDotted, lineWidth: 1,
      title: "EQ 50%", axisLabelVisible: true,
    });
  }, [anchorRange]);

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
    
    (candleSeriesRef.current as any).setMarkers(markers);
  }, [trades, candles]);

  return (
    <div className="relative flex-1 bg-zinc-950 min-h-0 border-b border-tv-border">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
