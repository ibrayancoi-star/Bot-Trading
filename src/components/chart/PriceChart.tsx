"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";
import { generateHistoricalData, subscribeMockFeed, modifyPosition, closePositionOnBridge } from "@/lib/data/mock-feed";
import { ema, rsi, macd } from "@/lib/indicators";
import type { Candle, Timeframe } from "@/lib/types/market";
import {
  INDICATOR_COLORS,
  useChartStore,
  type IndicatorKey,
} from "@/lib/store/chart-store";
import { formatPrice, formatVolume } from "@/lib/format";
import { IndicatorPill } from "./IndicatorPill";
import { MeasureOverlay } from "./MeasureOverlay";
import { useTradingStore } from "@/lib/store/trading-store";

interface MeasurePoint {
  time: number;
  price: number;
}
interface MeasureState {
  phase: "idle" | "placing" | "done";
  a: MeasurePoint | null;
  b: MeasurePoint | null;
}
const INITIAL_MEASURE: MeasureState = { phase: "idle", a: null, b: null };

function durationLabel(aTime: number, bTime: number): string {
  const diff = Math.abs(bTime - aTime);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

interface Props {
  symbol: string;
  timeframe: Timeframe;
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
  yellow: "#ffb74d",
  purple: "#ab47bc",
  grid: "#1e222d",
};

interface HoverInfo {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  time: number;
  pct: number;
}

interface LastValues {
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  volume?: number;
}

interface PaneOffset {
  top: number;
  height: number;
}

// [CHART-VISUAL-2] Interfaces y helper para detección de Fair Value Gap (FVG)
interface FVGZone {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  time: number;
  filled: boolean;
}

function detectFVGs(candles: Candle[]): FVGZone[] {
  const fvgs: FVGZone[] = [];
  if (candles.length < 3) return fvgs;

  for (let i = 0; i < candles.length - 2; i++) {
    const c1 = candles[i];
    const c3 = candles[i + 2];

    // FVG alcista: hueco entre high de c1 y low de c3
    if (c3.low > c1.high) {
      fvgs.push({
        type: "bullish",
        top: c3.low,
        bottom: c1.high,
        time: candles[i + 1].time,
        filled: false
      });
    }

    // FVG bajista: hueco entre low de c1 y high de c3
    if (c3.high < c1.low) {
      fvgs.push({
        type: "bearish",
        top: c1.low,
        bottom: c3.high,
        time: candles[i + 1].time,
        filled: false
      });
    }
  }

  // Marcar FVGs que ya fueron rellenados por precio posterior
  for (const fvg of fvgs) {
    const laterCandles = candles.filter(c => c.time > fvg.time);
    for (const lc of laterCandles) {
      if (fvg.type === "bullish" && lc.low <= fvg.bottom) {
        fvg.filled = true;
        break;
      }
      if (fvg.type === "bearish" && lc.high >= fvg.top) {
        fvg.filled = true;
        break;
      }
    }
  }

  // Retornar solo los NO rellenados (los activos)
  return fvgs.filter(f => !f.filled);
}

export function PriceChart({ symbol, timeframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);

  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi30Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsi70Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const priceLinesMapRef = useRef<Map<string, IPriceLine>>(new Map());
  // [CHART-VISUAL-FIX] FVG dibujado con priceLines (setMarkers no existe en esta versión)
  const fvgLinesRef = useRef<IPriceLine[]>([]);

  // [CHART-VISUAL-2] Refs para capas visuales
  const dailyHighLineRef = useRef<IPriceLine | null>(null);
  const dailyLowLineRef = useRef<IPriceLine | null>(null);
  const anchorHighLineRef = useRef<IPriceLine | null>(null);
  const anchorLowLineRef = useRef<IPriceLine | null>(null);
  const anchorEqLineRef = useRef<IPriceLine | null>(null);
  const sweepLineRef = useRef<IPriceLine | null>(null);
  const lastSweepUpdateRef = useRef<number>(0);

  const indicators = useChartStore((s) => s.indicators);
  const hidden = useChartStore((s) => s.hidden);
  const config = useChartStore((s) => s.config);
  const tool = useChartStore((s) => s.tool);
  const priceLines = useChartStore((s) => s.priceLines);
  const addPriceLine = useChartStore((s) => s.addPriceLine);
  const removeIndicator = useChartStore((s) => s.removeIndicator);
  const toggleHidden = useChartStore((s) => s.toggleHidden);
  const setSettingsTarget = useChartStore((s) => s.setSettingsTarget);

  // [CHART-VISUAL-2] Estados de capas visuales
  const dailyRange = useTradingStore((s) => s.dailyRanges[symbol]);
  const anchorRange = useTradingStore((s) => s.anchorRanges[symbol]);

  // Refs to avoid recreating subscribeClick on every tool change
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const addPriceLineRef = useRef(addPriceLine);
  addPriceLineRef.current = addPriceLine;
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const configRef = useRef(config);
  configRef.current = config;

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [lastPrice, setLastPrice] = useState<{ value: number; pct: number } | null>(null);
  const [lastValues, setLastValues] = useState<LastValues>({});
  const [paneOffsets, setPaneOffsets] = useState<PaneOffset[]>([]);
  const [measure, setMeasure] = useState<MeasureState>(INITIAL_MEASURE);
  const [renderTick, setRenderTick] = useState(0);
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // Helper — compute pane top offsets from chart layout
  function recomputePaneOffsets() {
    if (!chartRef.current) return;
    const panes = chartRef.current.panes();
    let top = 0;
    const offsets: PaneOffset[] = panes.map((p) => {
      const h = p.getHeight();
      const o = { top, height: h };
      top += h;
      return o;
    });
    setPaneOffsets(offsets);
  }

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: TV_COLORS.bg },
        textColor: TV_COLORS.text,
        fontFamily: "var(--font-sans), Inter, system-ui, sans-serif",
        fontSize: 11,
        // [UI] Ocultar el logo de atribución de TradingView (esquina inferior izquierda)
        attributionLogo: false,
        panes: { separatorColor: TV_COLORS.border, separatorHoverColor: TV_COLORS.border },
      },
      grid: {
        vertLines: { color: TV_COLORS.grid },
        horzLines: { color: TV_COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: TV_COLORS.textMuted, width: 1, style: 3, labelBackgroundColor: TV_COLORS.panel },
        horzLine: { color: TV_COLORS.textMuted, width: 1, style: 3, labelBackgroundColor: TV_COLORS.panel },
      },
      rightPriceScale: {
        borderColor: TV_COLORS.border,
        textColor: TV_COLORS.textMuted,
        // [UI-FIX-1] Más densidad de marcas en la escala lateral
        ticksVisible: true,
        minimumWidth: 65,
        borderVisible: true,
        // [UI-FIX-3] Márgenes de escala para mostrar más niveles intermedios
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      // [UI-FIX-1] Formato de precio con 5 decimales en la escala
      localization: {
        priceFormatter: (price: number) => price.toFixed(5),
      },
      timeScale: {
        borderColor: TV_COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
      autoSize: true,
    });

    // PANE 0 — Candles + EMAs
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: TV_COLORS.green,
      downColor: TV_COLORS.red,
      borderUpColor: TV_COLORS.green,
      borderDownColor: TV_COLORS.red,
      wickUpColor: TV_COLORS.green,
      wickDownColor: TV_COLORS.red,
      priceLineColor: TV_COLORS.textMuted,
      priceLineStyle: 2,
      // [UI-FIX-1] Precisión de 5 decimales / paso de 1 point → más niveles intermedios
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
    });

    // [UI-FIX-3] Las EMAs comparten la escala principal → mismo priceFormat de 5 decimales
    const emaPriceFormat = { type: "price" as const, precision: 5, minMove: 0.00001 };
    ema20Ref.current = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.ema20,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: emaPriceFormat,
    });
    ema50Ref.current = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.ema50,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: emaPriceFormat,
    });
    ema200Ref.current = chart.addSeries(LineSeries, {
      color: INDICATOR_COLORS.ema200,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: emaPriceFormat,
    });

    ema9Ref.current = chart.addSeries(LineSeries, {
      color: "#38bdf8",
      lineWidth: 1.5 as any,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: emaPriceFormat,
    });
    ema21Ref.current = chart.addSeries(LineSeries, {
      color: "#f97316",
      lineWidth: 1.5 as any,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: emaPriceFormat,
    });

    chartRef.current = chart;

    // Click handler — add horizontal price line when hline tool is active
    chart.subscribeClick((param) => {
      if (!param.point || !candleSeriesRef.current) return;
      const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
      if (price === null || !isFinite(price)) return;

      if (toolRef.current === "hline") {
        addPriceLineRef.current(price, symbolRef.current);
        return;
      }

      if (toolRef.current === "measure") {
        if (!param.time) return;
        const time = Number(param.time);
        const current = measureRef.current;
        if (current.phase === "idle") {
          setMeasure({
            phase: "placing",
            a: { time, price },
            b: { time, price },
          });
        } else if (current.phase === "placing") {
          setMeasure({
            phase: "done",
            a: current.a,
            b: { time, price },
          });
        } else {
          setMeasure({
            phase: "placing",
            a: { time, price },
            b: { time, price },
          });
        }
      }
    });

    // Crosshair handler
    chart.subscribeCrosshairMove((param) => {
      if (
        toolRef.current === "measure" &&
        measureRef.current.phase === "placing" &&
        param.point &&
        param.time &&
        candleSeriesRef.current
      ) {
        const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
        if (price !== null && isFinite(price)) {
          const time = Number(param.time);
          setMeasure((prev) =>
            prev.phase === "placing" ? { ...prev, b: { time, price } } : prev,
          );
        }
      }

      if (!param.time || !candleSeriesRef.current) {
        setHover(null);
        return;
      }
      const data = param.seriesData.get(candleSeriesRef.current);
      const vol = volumeSeriesRef.current
        ? param.seriesData.get(volumeSeriesRef.current)
        : null;
      if (data && "open" in data) {
        const o = data.open as number;
        const c = data.close as number;
        setHover({
          o,
          h: data.high as number,
          l: data.low as number,
          c,
          v: vol && "value" in vol ? (vol.value as number) : 0,
          time: Number(param.time),
          pct: o === 0 ? 0 : ((c - o) / o) * 100,
        });
      }
    });

    // Re-render measure overlay on pan / zoom so pixel coords stay in sync
    const tsRangeHandler = () => setRenderTick((t) => t + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(tsRangeHandler);
    const logicalRangeHandler = () => setRenderTick((t) => t + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRangeHandler);

    // ResizeObserver — recompute pane offsets when chart container resizes
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => recomputePaneOffsets());
    });
    ro.observe(containerRef.current);
    recomputePaneOffsets();

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(tsRangeHandler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(logicalRangeHandler);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesMapRef.current.clear();
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      ema9Ref.current = null;
      ema21Ref.current = null;
      rsiRef.current = null;
      rsi30Ref.current = null;
      rsi70Ref.current = null;
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
    };
  }, []);

  // Manage volume — overlay at the bottom of the main pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.volume && !volumeSeriesRef.current) {
      const v = chartRef.current.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          color: TV_COLORS.textMuted,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        0,
      );
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volumeSeriesRef.current = v;
      const data = candlesRef.current.map((k) => ({
        time: k.time as UTCTimestamp,
        value: k.volume,
        color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
      }));
      v.setData(data);
    } else if (!indicators.volume && volumeSeriesRef.current && chartRef.current) {
      chartRef.current.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
  }, [indicators.volume]);

  // RSI pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.rsi && !rsiRef.current) {
      const paneIndex = 1;
      const r = chartRef.current.addSeries(
        LineSeries,
        {
          color: INDICATOR_COLORS.rsi,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const r30 = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.textMuted,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const r70 = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.textMuted,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      rsiRef.current = r;
      rsi30Ref.current = r30;
      rsi70Ref.current = r70;
      try {
        chartRef.current.panes()[1]?.setStretchFactor(1);
        chartRef.current.panes()[0]?.setStretchFactor(3);
      } catch {}
      updateRSI();
    } else if (!indicators.rsi && rsiRef.current && chartRef.current) {
      chartRef.current.removeSeries(rsiRef.current);
      if (rsi30Ref.current) chartRef.current.removeSeries(rsi30Ref.current);
      if (rsi70Ref.current) chartRef.current.removeSeries(rsi70Ref.current);
      rsiRef.current = null;
      rsi30Ref.current = null;
      rsi70Ref.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.rsi]);

  // MACD pane
  useEffect(() => {
    if (!chartRef.current) return;
    if (indicators.macd && !macdRef.current) {
      const paneIndex = indicators.rsi ? 2 : 1;
      const m = chartRef.current.addSeries(
        LineSeries,
        {
          color: INDICATOR_COLORS.macd,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const s = chartRef.current.addSeries(
        LineSeries,
        {
          color: TV_COLORS.yellow,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        paneIndex,
      );
      const h = chartRef.current.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        paneIndex,
      );
      macdRef.current = m;
      macdSignalRef.current = s;
      macdHistRef.current = h;
      try {
        chartRef.current.panes()[paneIndex]?.setStretchFactor(1);
        chartRef.current.panes()[0]?.setStretchFactor(3);
      } catch {}
      updateMACD();
    } else if (!indicators.macd && macdRef.current && chartRef.current) {
      if (macdRef.current) chartRef.current.removeSeries(macdRef.current);
      if (macdSignalRef.current) chartRef.current.removeSeries(macdSignalRef.current);
      if (macdHistRef.current) chartRef.current.removeSeries(macdHistRef.current);
      macdRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
    }
    requestAnimationFrame(() => recomputePaneOffsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.macd, indicators.rsi]);

  // Visibility — eye toggle (hidden state) + enabled state combined
  useEffect(() => {
    const v = (key: IndicatorKey) => indicators[key] && !hidden[key];
    ema20Ref.current?.applyOptions({ visible: v("ema20") });
    ema50Ref.current?.applyOptions({ visible: v("ema50") });
    ema200Ref.current?.applyOptions({ visible: v("ema200") });
    if (rsiRef.current) rsiRef.current.applyOptions({ visible: v("rsi") });
    if (rsi30Ref.current) rsi30Ref.current.applyOptions({ visible: v("rsi") });
    if (rsi70Ref.current) rsi70Ref.current.applyOptions({ visible: v("rsi") });
    if (macdRef.current) macdRef.current.applyOptions({ visible: v("macd") });
    if (macdSignalRef.current) macdSignalRef.current.applyOptions({ visible: v("macd") });
    if (macdHistRef.current) macdHistRef.current.applyOptions({ visible: v("macd") });
    if (volumeSeriesRef.current) volumeSeriesRef.current.applyOptions({ visible: v("volume") });
  }, [indicators, hidden]);

  // Recompute indicators when config changes (periods)
  useEffect(() => {
    updateEMAs();
  }, [config.ema20, config.ema50, config.ema200]);

  useEffect(() => {
    updateRSI();
  }, [config.rsi]);

  useEffect(() => {
    updateMACD();
  }, [config.macdFast, config.macdSlow, config.macdSignal]);

  // Sync price lines from store to the candle series
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const map = priceLinesMapRef.current;
    const linesForThisSymbol = priceLines.filter((p) => p.symbol === symbol);
    const activeIds = new Set(linesForThisSymbol.map((p) => p.id));

    for (const [id, apiLine] of map.entries()) {
      if (!activeIds.has(id)) {
        try {
          series.removePriceLine(apiLine);
        } catch {}
        map.delete(id);
      }
    }
    for (const pl of linesForThisSymbol) {
      if (!map.has(pl.id)) {
        const apiLine = series.createPriceLine({
          price: pl.price,
          color: TV_COLORS.blue,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "",
        });
        map.set(pl.id, apiLine);
      }
    }
  }, [priceLines, symbol]);

  // Positions price lines — interactive drag for SL/TP
  const positions = useTradingStore((s) => s.positions);
  const positionLinesMapRef = useRef<Map<string, IPriceLine>>(new Map());
  const dragStateRef = useRef<{
    active: boolean;
    lineType: "sl" | "tp";
    posId: string;
    ticket: number;
    startY: number;
    startPrice: number;
    otherValue: number; // The TP when dragging SL, and vice versa
  } | null>(null);

  // Setup drag handlers once
  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!container || !chart || !series) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (!candleSeriesRef.current) return;
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const clickPrice = candleSeriesRef.current.coordinateToPrice(y);
      if (clickPrice === null || !isFinite(clickPrice)) return;

      // Check if click is near any SL/TP line
      const currentPositions = useTradingStore.getState().positions;
      const currentSymbol = useChartStore.getState().symbol;
      const threshold = Math.abs(clickPrice) * 0.0003; // 0.03% tolerance

      for (const pos of currentPositions) {
        if (pos.symbol !== currentSymbol) continue;
        const ticket = pos.ticket || parseInt(pos.id);

        if (pos.sl && pos.sl > 0 && Math.abs(clickPrice - pos.sl) < threshold) {
          dragStateRef.current = {
            active: true,
            lineType: "sl",
            posId: pos.id,
            ticket,
            startY: y,
            startPrice: pos.sl,
            otherValue: pos.tp || 0,
          };
          container.style.cursor = "ns-resize";
          e.preventDefault();
          return;
        }
        if (pos.tp && pos.tp > 0 && Math.abs(clickPrice - pos.tp) < threshold) {
          dragStateRef.current = {
            active: true,
            lineType: "tp",
            posId: pos.id,
            ticket,
            startY: y,
            startPrice: pos.tp,
            otherValue: pos.sl || 0,
          };
          container.style.cursor = "ns-resize";
          e.preventDefault();
          return;
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag || !drag.active || !candleSeriesRef.current) return;

      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const newPrice = candleSeriesRef.current.coordinateToPrice(y);
      if (newPrice === null || !isFinite(newPrice)) return;

      // Update the visual line position in real-time
      const map = positionLinesMapRef.current;
      const lineId = drag.lineType === "sl" ? `pos_sl_${drag.posId}` : `pos_tp_${drag.posId}`;
      const line = map.get(lineId);
      if (line) {
        line.applyOptions({ price: parseFloat(newPrice.toFixed(5)) });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag || !drag.active) return;

      container.style.cursor = "";
      
      if (candleSeriesRef.current) {
        const rect = container.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const finalPrice = candleSeriesRef.current.coordinateToPrice(y);
        if (finalPrice !== null && isFinite(finalPrice)) {
          const rounded = parseFloat(finalPrice.toFixed(5));
          if (drag.lineType === "sl") {
            modifyPosition(drag.ticket, drag.otherValue, rounded);
          } else {
            modifyPosition(drag.ticket, rounded, drag.otherValue);
          }
        }
      }

      dragStateRef.current = null;
    };

    // Hover cursor change near SL/TP lines
    const handleHoverCheck = (e: MouseEvent) => {
      if (dragStateRef.current?.active) return;
      if (!candleSeriesRef.current) return;

      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const hoverPrice = candleSeriesRef.current.coordinateToPrice(y);
      if (hoverPrice === null || !isFinite(hoverPrice)) return;

      const currentPositions = useTradingStore.getState().positions;
      const currentSymbol = useChartStore.getState().symbol;
      const threshold = Math.abs(hoverPrice) * 0.0003;

      let nearLine = false;
      for (const pos of currentPositions) {
        if (pos.symbol !== currentSymbol) continue;
        if ((pos.sl && pos.sl > 0 && Math.abs(hoverPrice - pos.sl) < threshold) ||
            (pos.tp && pos.tp > 0 && Math.abs(hoverPrice - pos.tp) < threshold)) {
          nearLine = true;
          break;
        }
      }

      if (toolRef.current === "cursor") {
        container.style.cursor = nearLine ? "ns-resize" : "";
      }
    };

    container.addEventListener("mousedown", handleMouseDown);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mousemove", handleHoverCheck);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mousemove", handleHoverCheck);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const map = positionLinesMapRef.current;
    
    // Create new maps to track what should be active
    const activeLineIds = new Set<string>();

    positions.filter(p => p.symbol === symbol).forEach((pos) => {
      if (!pos.open_price && !pos.entryPrice) return;

      const posId = pos.ticket ?? pos.id;
      const posType = (pos.type ?? pos.order_type ?? "buy").toString().toUpperCase();
      const posEntryPrice = pos.open_price ?? pos.entryPrice ?? pos.price;
      const posLotSize = pos.volume ?? pos.lotSize ?? 0;
      const posPnl = pos.profit ?? pos.pnl ?? 0;

      // Entry Line
      const entryId = `pos_entry_${posId}`;
      activeLineIds.add(entryId);
      if (!map.has(entryId)) {
        const pl = series.createPriceLine({
          price: posEntryPrice,
          color: posType === "BUY" ? TV_COLORS.blue : TV_COLORS.red,
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `${posType} ${posLotSize}`,
        });
        map.set(entryId, pl);
      } else {
         // Update title with live PnL
         map.get(entryId)?.applyOptions({ price: posEntryPrice, title: `${posType} ${posLotSize} (${posPnl > 0 ? '+':''}${posPnl.toFixed(2)})` });
      }

      // SL Line
      if (pos.sl && pos.sl > 0) {
        const slId = `pos_sl_${posId}`;
        activeLineIds.add(slId);
        if (!map.has(slId)) {
          const pl = series.createPriceLine({
            price: pos.sl,
            color: TV_COLORS.red,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `SL`,
          });
          map.set(slId, pl);
        } else {
          // Only update if not currently being dragged
          if (!dragStateRef.current?.active || dragStateRef.current?.posId !== posId || dragStateRef.current?.lineType !== "sl") {
            map.get(slId)?.applyOptions({ price: pos.sl });
          }
        }
      }

      // TP Line
      if (pos.tp && pos.tp > 0) {
        const tpId = `pos_tp_${posId}`;
        activeLineIds.add(tpId);
        if (!map.has(tpId)) {
          const pl = series.createPriceLine({
            price: pos.tp,
            color: TV_COLORS.green,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `TP`,
          });
          map.set(tpId, pl);
        } else {
          if (!dragStateRef.current?.active || dragStateRef.current?.posId !== posId || dragStateRef.current?.lineType !== "tp") {
            map.get(tpId)?.applyOptions({ price: pos.tp });
          }
        }
      }
    });

    // Cleanup old lines
    for (const [id, apiLine] of map.entries()) {
      if (!activeLineIds.has(id)) {
        try {
          series.removePriceLine(apiLine);
        } catch {}
        map.delete(id);
      }
    }
  }, [positions, symbol]);

  // [CHART-VISUAL-2] Capa 1: Rango Diario (D1 High/Low)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    if (dailyHighLineRef.current) {
      try {
        series.removePriceLine(dailyHighLineRef.current);
      } catch {}
      dailyHighLineRef.current = null;
    }
    if (dailyLowLineRef.current) {
      try {
        series.removePriceLine(dailyLowLineRef.current);
      } catch {}
      dailyLowLineRef.current = null;
    }

    if (!dailyRange) return;

    dailyHighLineRef.current = series.createPriceLine({
      price: dailyRange.high,
      color: "#22c55e",
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      title: "D1 High",
      axisLabelVisible: true,
    });

    dailyLowLineRef.current = series.createPriceLine({
      price: dailyRange.low,
      color: "#ef4444",
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      title: "D1 Low",
      axisLabelVisible: true,
    });
  }, [dailyRange, symbol]);

  // [CHART-VISUAL-2] Capa 2: Rango H4 de Anclaje (CRT High/Low/EQ)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    if (anchorHighLineRef.current) {
      try {
        series.removePriceLine(anchorHighLineRef.current);
      } catch {}
      anchorHighLineRef.current = null;
    }
    if (anchorLowLineRef.current) {
      try {
        series.removePriceLine(anchorLowLineRef.current);
      } catch {}
      anchorLowLineRef.current = null;
    }
    if (anchorEqLineRef.current) {
      try {
        series.removePriceLine(anchorEqLineRef.current);
      } catch {}
      anchorEqLineRef.current = null;
    }

    if (!anchorRange) return;

    anchorHighLineRef.current = series.createPriceLine({
      price: anchorRange.high,
      color: "#3b82f6",
      lineStyle: LineStyle.Solid,
      lineWidth: 2,
      title: "CRT H",
      axisLabelVisible: true,
    });

    anchorLowLineRef.current = series.createPriceLine({
      price: anchorRange.low,
      color: "#3b82f6",
      lineStyle: LineStyle.Solid,
      lineWidth: 2,
      title: "CRT L",
      axisLabelVisible: true,
    });

    anchorEqLineRef.current = series.createPriceLine({
      price: anchorRange.eq,
      color: "#eab308",
      lineStyle: LineStyle.SparseDotted,
      lineWidth: 1,
      title: "EQ 50%",
      axisLabelVisible: true,
    });
  }, [anchorRange, symbol]);

  // [CHART-VISUAL-2] Capa 3: Zona de Sweep Esperado (naranja, con throttle de 5s)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !anchorRange || !lastPrice?.value) {
      if (sweepLineRef.current && series) {
        try {
          series.removePriceLine(sweepLineRef.current);
        } catch {}
        sweepLineRef.current = null;
      }
      return;
    }

    const now = Date.now();
    if (now - lastSweepUpdateRef.current < 5000 && sweepLineRef.current) {
      return;
    }
    lastSweepUpdateRef.current = now;

    const currentPrice = lastPrice.value;
    const distToHigh = Math.abs(anchorRange.high - currentPrice);
    const distToLow = Math.abs(anchorRange.low - currentPrice);
    const direction = distToLow < distToHigh ? "BUY" : "SELL";
    const sweepPrice = direction === "BUY" ? anchorRange.low : anchorRange.high;

    if (sweepLineRef.current) {
      try {
        series.removePriceLine(sweepLineRef.current);
      } catch {}
      sweepLineRef.current = null;
    }

    sweepLineRef.current = series.createPriceLine({
      price: sweepPrice,
      color: "#f97316",
      lineStyle: LineStyle.Dotted,
      lineWidth: 2,
      title: `⚡ Sweep → ${direction}`,
      axisLabelVisible: true,
    });
  }, [lastPrice?.value, anchorRange, symbol]);

  // Cursor style when drawing tools are active + reset measure on tool change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor =
        tool === "hline" || tool === "measure" ? "crosshair" : "";
    }
    if (tool !== "measure") setMeasure(INITIAL_MEASURE);
  }, [tool]);

  function updateEMAs() {
    const c = candlesRef.current;
    if (c.length === 0) return;
    const cfg = configRef.current;
    let last20: number | undefined;
    let last50: number | undefined;
    let last200: number | undefined;

    if (ema20Ref.current) {
      const data = ema(c, cfg.ema20);
      ema20Ref.current.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      last20 = data.at(-1)?.value;
    }
    if (ema50Ref.current) {
      const data = ema(c, cfg.ema50);
      ema50Ref.current.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      last50 = data.at(-1)?.value;
    }
    if (ema200Ref.current) {
      const data = ema(c, cfg.ema200);
      ema200Ref.current.setData(
        data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
      last200 = data.at(-1)?.value;
    }
    const lastVol = c.at(-1)?.volume;
    setLastValues((prev) => ({
      ...prev,
      ema20: last20,
      ema50: last50,
      ema200: last200,
      volume: lastVol,
    }));
  }

  function updateRSI() {
    const c = candlesRef.current;
    if (c.length === 0 || !rsiRef.current) return;
    const cfg = configRef.current;
    const data = rsi(c, cfg.rsi).map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value,
    }));
    rsiRef.current.setData(data);
    if (rsi30Ref.current && data.length > 0)
      rsi30Ref.current.setData([
        { time: data[0].time, value: 30 },
        { time: data[data.length - 1].time, value: 30 },
      ]);
    if (rsi70Ref.current && data.length > 0)
      rsi70Ref.current.setData([
        { time: data[0].time, value: 70 },
        { time: data[data.length - 1].time, value: 70 },
      ]);
    setLastValues((prev) => ({ ...prev, rsi: data.at(-1)?.value }));
  }

  function updateMACD() {
    const c = candlesRef.current;
    if (c.length === 0 || !macdRef.current) return;
    const cfg = configRef.current;
    const m = macd(c, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
    macdRef.current.setData(
      m.map((p) => ({ time: p.time as UTCTimestamp, value: p.macd })),
    );
    macdSignalRef.current?.setData(
      m.map((p) => ({ time: p.time as UTCTimestamp, value: p.signal })),
    );
    macdHistRef.current?.setData(
      m.map((p) => ({
        time: p.time as UTCTimestamp,
        value: p.histogram,
        color: p.histogram >= 0 ? `${TV_COLORS.green}80` : `${TV_COLORS.red}80`,
      })),
    );
    const last = m.at(-1);
    setLastValues((prev) => ({
      ...prev,
      macd: last?.macd,
      macdSignal: last?.signal,
      macdHist: last?.histogram,
    }));
  }

  // [CHART-VISUAL-FIX] Capa 4: Zonas FVG dibujadas con priceLines (compatible con todas las versiones)
  function updateFVGs() {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Limpiar FVGs anteriores
    for (const line of fvgLinesRef.current) {
      try { series.removePriceLine(line); } catch { /* línea ya removida */ }
    }
    fvgLinesRef.current = [];

    // Solo mostrar FVGs en temporalidades bajas
    const showFVG = timeframe === "1m" || timeframe === "3m" || timeframe === "5m" || timeframe === "15m" || timeframe === "30m";
    if (!showFVG) return;

    const c = candlesRef.current;
    if (c.length < 3) return;

    // Reutiliza la detección existente; dibuja los últimos 5 como pares de priceLines
    const recent = detectFVGs(c).slice(-5);
    for (const fvg of recent) {
      const color = fvg.type === "bullish" ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)";
      const topLine = series.createPriceLine({
        price: fvg.top,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      });
      const bottomLine = series.createPriceLine({
        price: fvg.bottom,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: fvg.type === "bullish" ? "FVG ▲" : "FVG ▼",
      });
      fvgLinesRef.current.push(topLine, bottomLine);
    }
  }

  // Load mock historical data + subscribe to simulated live ticks
  useEffect(() => {
    let unsub: (() => void) | null = null;

    // ── 1. Clear chart while waiting for MT5 history ───────────────────────
    candlesRef.current = [];

    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData([]);
    }
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData([]);
    }
    updateEMAs();
    updateRSI();
    updateMACD();
    updateFVGs();
    chartRef.current?.timeScale().fitContent();
    requestAnimationFrame(() => recomputePaneOffsets());

    // ── 2. Subscribe to real-time ticks & MT5 history updates ───────────────
    unsub = subscribeMockFeed(
      (k) => {
        // Callback para actualizaciones de ticks individuales
        if (!candleSeriesRef.current) return;
        const arr = candlesRef.current;
        const lastCandle = arr[arr.length - 1];
        if (lastCandle && lastCandle.time === k.time) {
          arr[arr.length - 1] = k;
        } else if (!lastCandle || k.time > lastCandle.time) {
          arr.push(k);
          if (arr.length > 2000) arr.shift();
        } else {
          return;
        }
        candleSeriesRef.current.update({
          time: k.time as UTCTimestamp,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        });
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.update({
            time: k.time as UTCTimestamp,
            value: k.volume,
            color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
          });
        }
        if (k.indicators) {
          if (ema9Ref.current && k.indicators.ema_9 !== undefined) {
            ema9Ref.current.update({ time: k.time as UTCTimestamp, value: k.indicators.ema_9 });
          }
          if (ema21Ref.current && k.indicators.ema_21 !== undefined) {
            ema21Ref.current.update({ time: k.time as UTCTimestamp, value: k.indicators.ema_21 });
          }
        }
        updateEMAs();
        updateRSI();
        updateMACD();
        updateFVGs();
        const prev = arr[arr.length - 2] ?? lastCandle;
        setLastPrice({
          value: k.close,
          pct: prev && prev.close !== 0 ? ((k.close - prev.close) / prev.close) * 100 : 0,
        });
      },
      (historyData) => {
        // Callback al recibir el historial real de MT5 vía WebSocket
        if (historyData.length === 0) return;
        
        candlesRef.current = historyData;
        
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData(
            historyData.map((k) => ({
              time: k.time as UTCTimestamp,
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
            })),
          );
        }
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(
            historyData.map((k) => ({
              time: k.time as UTCTimestamp,
              value: k.volume,
              color: k.close >= k.open ? `${TV_COLORS.green}66` : `${TV_COLORS.red}66`,
            })),
          );
        }
        if (ema9Ref.current) {
          const ema9Data = historyData
            .filter((c) => c.indicators?.ema_9 !== undefined)
            .map((c) => ({ time: c.time as UTCTimestamp, value: c.indicators!.ema_9! }));
          ema9Ref.current.setData(ema9Data);
        }
        if (ema21Ref.current) {
          const ema21Data = historyData
            .filter((c) => c.indicators?.ema_21 !== undefined)
            .map((c) => ({ time: c.time as UTCTimestamp, value: c.indicators!.ema_21! }));
          ema21Ref.current.setData(ema21Data);
        }
        updateEMAs();
        updateRSI();
        updateMACD();
        updateFVGs();
        chartRef.current?.timeScale().fitContent();
        
        const last = historyData[historyData.length - 1];
        const prev = historyData[historyData.length - 2] ?? last;
        setLastPrice({
          value: last.close,
          pct: prev.close === 0 ? 0 : ((last.close - prev.close) / prev.close) * 100,
        });
      }
    );

    return () => {
      if (unsub) unsub();
    };
  }, [symbol, timeframe]);

  const greenOrRed = (n: number) =>
    n >= 0 ? "text-tv-green" : "text-tv-red";

  // Helpers for pill rendering
  const isShown = (key: IndicatorKey) =>
    indicators[key] && (key === "volume" || true); // always renderable if enabled
  void isShown;

  // Determine which pane each indicator lives in (based on current layout)
  const rsiPaneIdx = 1;
  const macdPaneIdx = indicators.rsi ? 2 : 1;

  let measureRender: React.ReactNode = null;
  if (
    measure.a &&
    measure.b &&
    chartRef.current &&
    candleSeriesRef.current
  ) {
    const ts = chartRef.current.timeScale();
    const aX = ts.timeToCoordinate(measure.a.time as UTCTimestamp);
    const bX = ts.timeToCoordinate(measure.b.time as UTCTimestamp);
    const aY = candleSeriesRef.current.priceToCoordinate(measure.a.price);
    const bY = candleSeriesRef.current.priceToCoordinate(measure.b.price);

    if (aX !== null && bX !== null && aY !== null && bY !== null) {
      const priceDiff = measure.b.price - measure.a.price;
      const pctChange =
        measure.a.price === 0 ? 0 : (priceDiff / measure.a.price) * 100;
      const isUp = priceDiff >= 0;
      const start = Math.min(measure.a.time, measure.b.time);
      const end = Math.max(measure.a.time, measure.b.time);
      const inRange = candlesRef.current.filter(
        (c) => c.time >= start && c.time <= end,
      );
      const bars = inRange.length;
      const volume = inRange.reduce((s, c) => s + c.volume, 0);
      const dur = durationLabel(measure.a.time, measure.b.time);

      measureRender = (
        <MeasureOverlay
          aX={aX}
          aY={aY}
          bX={bX}
          bY={bY}
          priceDiff={priceDiff}
          pctChange={pctChange}
          bars={bars}
          volume={volume}
          durationText={dur}
          isUp={isUp}
          isPreview={measure.phase === "placing"}
        />
      );
    }
  }
  void renderTick;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {measureRender}

      {/* Top-left of main pane: symbol info + OHLC + Volume pill + EMA pills */}
      <div
        style={{ top: (paneOffsets[0]?.top ?? 0) + 12, left: 12 }}
        className="pointer-events-none absolute z-10 flex flex-col gap-1 text-xs tabular-nums"
      >
        {/* Row 1: symbol info + OHLC stats inline on hover (fixed height, never wraps) */}
        <div className="flex h-5 flex-nowrap items-center gap-x-3 overflow-hidden whitespace-nowrap">
          <div className="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
            <span className="text-tv-text">{symbol}</span>
            <span className="text-tv-text-muted">·</span>
            <span className="uppercase text-tv-text-muted">{timeframe}</span>
            <span className="text-tv-text-muted">·</span>
            <span className="text-tv-text-muted">MT5 · CRT</span>
          </div>
          {hover && (
            <div className="flex items-center gap-x-3 text-[11px]">
              <span className="text-tv-text-muted">
                O <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.o)}</span>
              </span>
              <span className="text-tv-text-muted">
                H <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.h)}</span>
              </span>
              <span className="text-tv-text-muted">
                L <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.l)}</span>
              </span>
              <span className="text-tv-text-muted">
                C <span className={greenOrRed(hover.c - hover.o)}>{formatPrice(hover.c)}</span>
              </span>
              <span className={greenOrRed(hover.pct)}>
                {hover.pct >= 0 ? "+" : ""}
                {hover.pct.toFixed(2)}%
              </span>
              <span className="text-tv-text-muted">
                Vol <span className="text-tv-text">{formatVolume(hover.v)}</span>
              </span>
            </div>
          )}
        </div>

        {/* Row 2: big live price (always present — reserves space even while loading) */}
        <div className="flex h-7 items-center gap-2">
          {lastPrice ? (
            <>
              <span className={`text-lg font-semibold tabular-nums ${greenOrRed(lastPrice.pct)}`}>
                {formatPrice(lastPrice.value)}
              </span>
              <span className={`text-xs ${greenOrRed(lastPrice.pct)}`}>
                {lastPrice.pct >= 0 ? "+" : ""}
                {lastPrice.pct.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="text-xs text-tv-text-muted">Cargando…</span>
          )}
        </div>

        {/* Indicator pills for the main pane (fixed position below price) */}
        <div className="mt-1 flex flex-col items-start gap-1">
          {indicators.ema20 && (
            <IndicatorPill
              name={`EMA ${config.ema20}`}
              value={lastValues.ema20 !== undefined ? formatPrice(lastValues.ema20) : undefined}
              color={INDICATOR_COLORS.ema20}
              hidden={hidden.ema20}
              onToggleHide={() => toggleHidden("ema20")}
              onSettings={() => setSettingsTarget("ema20")}
              onRemove={() => removeIndicator("ema20")}
            />
          )}
          {indicators.ema50 && (
            <IndicatorPill
              name={`EMA ${config.ema50}`}
              value={lastValues.ema50 !== undefined ? formatPrice(lastValues.ema50) : undefined}
              color={INDICATOR_COLORS.ema50}
              hidden={hidden.ema50}
              onToggleHide={() => toggleHidden("ema50")}
              onSettings={() => setSettingsTarget("ema50")}
              onRemove={() => removeIndicator("ema50")}
            />
          )}
          {indicators.ema200 && (
            <IndicatorPill
              name={`EMA ${config.ema200}`}
              value={lastValues.ema200 !== undefined ? formatPrice(lastValues.ema200) : undefined}
              color={INDICATOR_COLORS.ema200}
              hidden={hidden.ema200}
              onToggleHide={() => toggleHidden("ema200")}
              onSettings={() => setSettingsTarget("ema200")}
              onRemove={() => removeIndicator("ema200")}
            />
          )}
          {indicators.volume && (
            <IndicatorPill
              name="Vol"
              value={lastValues.volume !== undefined ? formatVolume(lastValues.volume) : undefined}
              color={INDICATOR_COLORS.volume}
              hidden={hidden.volume}
              onToggleHide={() => toggleHidden("volume")}
              onSettings={() => setSettingsTarget("volume")}
              onRemove={() => removeIndicator("volume")}
            />
          )}
        </div>
      </div>

      {/* RSI pane label */}
      {indicators.rsi && paneOffsets[rsiPaneIdx] && (
        <div
          style={{ top: paneOffsets[rsiPaneIdx].top + 6, left: 12 }}
          className="pointer-events-none absolute z-10"
        >
          <IndicatorPill
            name={`RSI ${config.rsi}`}
            value={lastValues.rsi !== undefined ? lastValues.rsi.toFixed(2) : undefined}
            color={INDICATOR_COLORS.rsi}
            hidden={hidden.rsi}
            onToggleHide={() => toggleHidden("rsi")}
            onSettings={() => setSettingsTarget("rsi")}
            onRemove={() => removeIndicator("rsi")}
          />
        </div>
      )}

      {/* MACD pane label */}
      {indicators.macd && paneOffsets[macdPaneIdx] && (
        <div
          style={{ top: paneOffsets[macdPaneIdx].top + 6, left: 12 }}
          className="pointer-events-none absolute z-10"
        >
          <IndicatorPill
            name={`MACD ${config.macdFast}, ${config.macdSlow}, ${config.macdSignal}`}
            value={
              lastValues.macd !== undefined
                ? `${lastValues.macd.toFixed(2)} / ${(lastValues.macdSignal ?? 0).toFixed(2)}`
                : undefined
            }
            color={INDICATOR_COLORS.macd}
            hidden={hidden.macd}
            onToggleHide={() => toggleHidden("macd")}
            onSettings={() => setSettingsTarget("macd")}
            onRemove={() => removeIndicator("macd")}
          />
        </div>
      )}

      {/* [BIAS] Panel de Bias del rango D1 (esquina inferior izquierda, sobre la escala de tiempo) */}
      {dailyRange && (
        <div className="absolute left-3 bottom-9 z-10 flex items-center gap-2.5 rounded-lg border border-tv-border bg-tv-panel/90 px-3.5 py-2 text-xs text-tv-text backdrop-blur-md shadow-lg pointer-events-auto">
          <span className="font-semibold text-tv-text-muted">Bias D1</span>
          <span
            className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold ${
              dailyRange.bias === "BUY"
                ? "bg-tv-green/15 text-tv-green"
                : dailyRange.bias === "SELL"
                  ? "bg-tv-red/15 text-tv-red"
                  : "bg-tv-border/30 text-tv-text-muted"
            }`}
          >
            {dailyRange.bias === "BUY"
              ? "▲ BUY"
              : dailyRange.bias === "SELL"
                ? "▼ SELL"
                : "● NEUTRO"}
          </span>
          {dailyRange.time > 0 && (
            <span className="border-l border-tv-border/50 pl-2.5 text-[10px] text-tv-text-muted">
              {new Date(dailyRange.time * 1000).toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                timeZone: "UTC",
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
