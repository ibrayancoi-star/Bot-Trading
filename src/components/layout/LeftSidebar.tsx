"use client";

import { useState, useEffect } from "react";
import { useTradingStore, type BotConfig, type Strategy, type KillzoneName } from "@/lib/store/trading-store";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Settings, Shield, Zap, Sparkles, Clock, Percent, X, Info } from "lucide-react";
import { cn } from "@/lib/utils";

function InfoBubble({ text }: { text: string }) {
  return (
    <div className="group relative inline-flex items-center cursor-help flex-shrink-0">
      <Info className="h-3 w-3 text-zinc-600 group-hover:text-tv-blue transition-colors" />
      <div className="
        absolute hidden group-hover:flex flex-col
        bottom-full left-1/2 -translate-x-1/2 mb-2
        w-52 bg-zinc-900 border border-zinc-700
        text-[11px] text-zinc-300 p-3
        rounded-xl shadow-2xl z-[60]
        normal-case font-normal leading-relaxed text-left
        pointer-events-none
      ">
        <p>{text}</p>
        <div className="absolute top-full left-1/2 -translate-x-1/2
                        border-4 border-transparent border-t-zinc-700" />
      </div>
    </div>
  );
}

export function LeftSidebar() {
  const isLeftSidebarOpen = useTradingStore((s) => s.isLeftSidebarOpen);
  const toggleLeftSidebar = useTradingStore((s) => s.toggleLeftSidebar);
  const botConfig = useTradingStore((s) => s.botConfig);
  const setBotConfig = useTradingStore((s) => s.setBotConfig);
  const draftBotConfig = useTradingStore((s) => s.draftBotConfig);
  const setDraftBotConfig = useTradingStore((s) => s.setDraftBotConfig);

  // Hydration state
  const [storeReady, setStoreReady] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Local state for form controls
  const [strategy, setStrategy] = useState<Strategy>("scalping");
  const [lotSize, setLotSize] = useState<number>(0.1);
  const [takeProfitPips, setTakeProfitPips] = useState<number>(20);
  const [stopLossPips, setStopLossPips] = useState<number>(15);
  const [maxPositions, setMaxPositions] = useState<number>(3);
  const [maxDailyLoss, setMaxDailyLoss] = useState<number>(2.5);
  const [chromaThreshold, setChromaThreshold] = useState<number>(0.72);
  const [chromaTopK, setChromaTopK] = useState<number>(5);
  const [killzones, setKillzones] = useState<Record<KillzoneName, boolean>>({
    asian: false,
    london: true,
    overlap: true,
    newyork: false,
  });
  const [trailingStop, setTrailingStop] = useState<boolean>(false);
  const [partialClose, setPartialClose] = useState<boolean>(false);
  const [partialClosePct, setPartialClosePct] = useState<number>(50);
  const [modelTbsRiskMultiplier, setModelTbsRiskMultiplier] = useState<number>(1.0);
  const [modelTwsRiskMultiplier, setModelTwsRiskMultiplier] = useState<number>(0.5);
  const [hybridM1M15Confluence, setHybridM1M15Confluence] = useState<boolean>(true);
  const [smtDivergenceCheck, setSmtDivergenceCheck] = useState<boolean>(true);

  // [CRT-IMPL-6] Nuevos estados locales
  const [requireCandleConfirmation, setRequireCandleConfirmation] = useState<boolean>(false);
  const [useDynamicSl, setUseDynamicSl] = useState<boolean>(false);
  const [useCrtTargets, setUseCrtTargets] = useState<boolean>(false);
  const [partialCloseAtEq, setPartialCloseAtEq] = useState<boolean>(false);
  const [smtDivergenceEnabled, setSmtDivergenceEnabled] = useState<boolean>(false);

  // Killzones dinámicas
  const [londonStart,  setLondonStart]  = useState<string>("07:00");
  const [londonEnd,    setLondonEnd]    = useState<string>("10:00");
  const [newYorkStart, setNewYorkStart] = useState<string>("12:00");
  const [newYorkEnd,   setNewYorkEnd]   = useState<string>("15:00");
  const [asianStart,   setAsianStart]   = useState<string>("02:00");
  const [asianEnd,     setAsianEnd]     = useState<string>("05:00");

  // Filtros con bypass
  const [maxSpreadPoints,     setMaxSpreadPoints]     = useState<number>(20);
  const [disableSpreadFilter, setDisableSpreadFilter] = useState<boolean>(false);
  const [minAtrPips,          setMinAtrPips]          = useState<number>(12);
  const [disableAtrFilter,    setDisableAtrFilter]    = useState<boolean>(false);
  const [maxWickBodyRatio,    setMaxWickBodyRatio]     = useState<number>(20);
  const [disableWickBodyFilter, setDisableWickBodyFilter] = useState<boolean>(false);

  // [BYPASS DIMENSIÓN]
  const [disableDimensionFilter,    setDisableDimensionFilter]    = useState<boolean>(false);
  const [minAmplitudeForexPct,      setMinAmplitudeForexPct]      = useState<number>(0.08);
  const [minAmplitudeIndicesPoints, setMinAmplitudeIndicesPoints] = useState<number>(20.0);

  // Dragging states
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Listen to Zustand store hydration status
  useEffect(() => {
    const unsub = useTradingStore.persist.onFinishHydration(() => {
      setStoreReady(true);
    });
    if (useTradingStore.persist.hasHydrated()) {
      setStoreReady(true);
    }
    return unsub;
  }, []);

  // Initialize local states from draft (or botConfig as fallback) once hydrated
  useEffect(() => {
    if (!storeReady) return;
    const configToUse = draftBotConfig || botConfig;
    if (configToUse && !initialized) {
      setStrategy(configToUse.strategy);
      setLotSize(configToUse.lotSize);
      setTakeProfitPips(configToUse.takeProfitPips);
      setStopLossPips(configToUse.stopLossPips);
      setMaxPositions(configToUse.maxPositions);
      setMaxDailyLoss(configToUse.maxDailyLoss);
      setChromaThreshold(configToUse.chromaThreshold);
      setChromaTopK(configToUse.chromaTopK);
      setKillzones(configToUse.killzones);
      setTrailingStop(configToUse.trailingStop);
      setPartialClose(configToUse.partialClose);
      setPartialClosePct(configToUse.partialClosePct);
      if (configToUse.modelTbsRiskMultiplier !== undefined) setModelTbsRiskMultiplier(configToUse.modelTbsRiskMultiplier);
      if (configToUse.modelTwsRiskMultiplier !== undefined) setModelTwsRiskMultiplier(configToUse.modelTwsRiskMultiplier);
      if (configToUse.hybridM1M15Confluence !== undefined) setHybridM1M15Confluence(configToUse.hybridM1M15Confluence);
      if (configToUse.smtDivergenceCheck !== undefined) setSmtDivergenceCheck(configToUse.smtDivergenceCheck);

      // [CRT-IMPL-6] Cargar estados nuevos
      if (configToUse.requireCandleConfirmation !== undefined) setRequireCandleConfirmation(configToUse.requireCandleConfirmation);
      if (configToUse.useDynamicSl !== undefined) setUseDynamicSl(configToUse.useDynamicSl);
      if (configToUse.useCrtTargets !== undefined) setUseCrtTargets(configToUse.useCrtTargets);
      if (configToUse.partialCloseAtEq !== undefined) setPartialCloseAtEq(configToUse.partialCloseAtEq);
      if (configToUse.smtDivergenceEnabled !== undefined) setSmtDivergenceEnabled(configToUse.smtDivergenceEnabled);

      if (configToUse.londonStart  !== undefined) setLondonStart(configToUse.londonStart);
      if (configToUse.londonEnd    !== undefined) setLondonEnd(configToUse.londonEnd);
      if (configToUse.newYorkStart !== undefined) setNewYorkStart(configToUse.newYorkStart);
      if (configToUse.newYorkEnd   !== undefined) setNewYorkEnd(configToUse.newYorkEnd);
      if (configToUse.asianStart   !== undefined) setAsianStart(configToUse.asianStart);
      if (configToUse.asianEnd     !== undefined) setAsianEnd(configToUse.asianEnd);

      if (configToUse.maxSpreadPoints       !== undefined) setMaxSpreadPoints(configToUse.maxSpreadPoints);
      if (configToUse.disableSpreadFilter   !== undefined) setDisableSpreadFilter(configToUse.disableSpreadFilter);
      if (configToUse.minAtrPips            !== undefined) setMinAtrPips(configToUse.minAtrPips);
      if (configToUse.disableAtrFilter      !== undefined) setDisableAtrFilter(configToUse.disableAtrFilter);
      if (configToUse.maxWickBodyRatio      !== undefined) setMaxWickBodyRatio(configToUse.maxWickBodyRatio);
      if (configToUse.disableWickBodyFilter !== undefined) setDisableWickBodyFilter(configToUse.disableWickBodyFilter);

      // [BYPASS DIMENSIÓN]
      if (configToUse.disableDimensionFilter    !== undefined) setDisableDimensionFilter(configToUse.disableDimensionFilter);
      if (configToUse.minAmplitudeForexPct      !== undefined) setMinAmplitudeForexPct(configToUse.minAmplitudeForexPct);
      if (configToUse.minAmplitudeIndicesPoints !== undefined) setMinAmplitudeIndicesPoints(configToUse.minAmplitudeIndicesPoints);

      setInitialized(true);
    }
  }, [storeReady, draftBotConfig, botConfig, initialized]);

  // Continuously write the local changes back to the store's draftBotConfig
  useEffect(() => {
    if (!storeReady || !initialized) return;

    const draft: BotConfig = {
      strategy,
      lotSize,
      takeProfitPips,
      stopLossPips,
      maxPositions,
      maxDailyLoss,
      chromaThreshold,
      chromaTopK,
      killzones,
      trailingStop,
      partialClose,
      partialClosePct,
      modelTbsRiskMultiplier,
      modelTwsRiskMultiplier,
      hybridM1M15Confluence,
      smtDivergenceCheck,
      londonStart,
      londonEnd,
      newYorkStart,
      newYorkEnd,
      asianStart,
      asianEnd,
      maxSpreadPoints,
      disableSpreadFilter,
      minAtrPips,
      disableAtrFilter,
      maxWickBodyRatio,
      disableWickBodyFilter,
      disableDimensionFilter,
      minAmplitudeForexPct,
      minAmplitudeIndicesPoints,
      requireCandleConfirmation,
      useDynamicSl,
      useCrtTargets,
      partialCloseAtEq,
      smtDivergenceEnabled,
    };

    setDraftBotConfig(draft);
  }, [
    storeReady,
    initialized,
    strategy,
    lotSize,
    takeProfitPips,
    stopLossPips,
    maxPositions,
    maxDailyLoss,
    chromaThreshold,
    chromaTopK,
    killzones,
    trailingStop,
    partialClose,
    partialClosePct,
    modelTbsRiskMultiplier,
    modelTwsRiskMultiplier,
    hybridM1M15Confluence,
    smtDivergenceCheck,
    londonStart,
    londonEnd,
    newYorkStart,
    newYorkEnd,
    asianStart,
    asianEnd,
    maxSpreadPoints,
    disableSpreadFilter,
    minAtrPips,
    disableAtrFilter,
    maxWickBodyRatio,
    disableWickBodyFilter,
    disableDimensionFilter,
    minAmplitudeForexPct,
    minAmplitudeIndicesPoints,
    requireCandleConfirmation,
    useDynamicSl,
    useCrtTargets,
    partialCloseAtEq,
    smtDivergenceEnabled,
    setDraftBotConfig,
  ]);

  // Escape key close listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isLeftSidebarOpen) {
        toggleLeftSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLeftSidebarOpen, toggleLeftSidebar]);

  // Dragging event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with left click on header
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    };
    const handleMouseUp = () => {
      setDragging(false);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, dragStart]);

  if (!isLeftSidebarOpen) return null;

  const handleApply = () => {
    const config: BotConfig = {
      strategy,
      lotSize,
      takeProfitPips,
      stopLossPips,
      maxPositions,
      maxDailyLoss,
      chromaThreshold,
      chromaTopK,
      killzones,
      trailingStop,
      partialClose,
      partialClosePct,
      modelTbsRiskMultiplier,
      modelTwsRiskMultiplier,
      hybridM1M15Confluence,
      smtDivergenceCheck,
      londonStart,
      londonEnd,
      newYorkStart,
      newYorkEnd,
      asianStart,
      asianEnd,
      maxSpreadPoints,
      disableSpreadFilter,
      minAtrPips,
      disableAtrFilter,
      maxWickBodyRatio,
      disableWickBodyFilter,
      // [BYPASS DIMENSIÓN]
      disableDimensionFilter,
      minAmplitudeForexPct,
      minAmplitudeIndicesPoints,
      requireCandleConfirmation,
      useDynamicSl,
      useCrtTargets,
      partialCloseAtEq,
      smtDivergenceEnabled,
    };
    setBotConfig(config);
    toggleLeftSidebar(); // Cierra tras aplicar la configuración
  };

  const toggleKillzone = (name: KillzoneName) => {
    setKillzones((prev) => ({
      ...prev,
      [name]: !prev[name],
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        // Cierra al hacer click fuera del modal
        if (e.target === e.currentTarget) toggleLeftSidebar();
      }}
    >
      <div
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
        className={cn(
          "flex w-96 max-h-[85vh] flex-col border border-zinc-800 bg-zinc-950 rounded-xl shadow-2xl overflow-y-auto overflow-x-hidden text-tv-text transition-all",
          dragging ? "shadow-tv-blue/10 border-tv-blue/30 scale-[1.01]" : ""
        )}
      >
        {/* Header del Panel (Arrastrable) */}
        <div
          onMouseDown={handleMouseDown}
          className="p-4 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between cursor-move select-none"
        >
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-tv-blue animate-spin-slow" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-tv-text">
              Configuración del Bot
            </h2>
          </div>
          <button
            onClick={toggleLeftSidebar}
            className="text-tv-text-muted hover:text-tv-text hover:bg-zinc-800/80 p-1 rounded transition-colors cursor-pointer"
            title="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sección 1: Gestión de Estrategia */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tv-text-muted uppercase">
            <Zap className="h-3.5 w-3.5 text-tv-blue" />
            <span>Gestión de Estrategia</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Estrategia Activa</span>
            <span className="text-sm font-medium text-zinc-100">CRT Institucional</span>
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-tv-text-muted">Lotaje Base</span>
              <InfoBubble text="Volumen de cada operación (en lotes)." />
            </div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={lotSize}
              onChange={(e) => setLotSize(parseFloat(e.target.value) || 0.01)}
              className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-16"
            />
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Sección 2: Gestión de Riesgo (TP/SL) */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tv-text-muted uppercase">
            <Shield className="h-3.5 w-3.5 text-tv-red" />
            <span>Límites de Riesgo</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 bg-tv-bg border border-zinc-800 rounded-md p-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-tv-text-muted">Take Profit (Pips)</span>
                <InfoBubble text="Distancia en pips para asegurar ganancias." />
              </div>
              <input
                type="number"
                min="1"
                value={takeProfitPips}
                onChange={(e) => setTakeProfitPips(parseInt(e.target.value) || 1)}
                className="bg-transparent text-left text-xs font-mono text-tv-text outline-none mt-1"
              />
            </div>
            <div className="flex flex-col gap-1 bg-tv-bg border border-zinc-800 rounded-md p-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-tv-text-muted">Stop Loss (Pips)</span>
                <InfoBubble text="Distancia máxima en pips para asumir pérdidas." />
              </div>
              <input
                type="number"
                min="1"
                value={stopLossPips}
                onChange={(e) => setStopLossPips(parseInt(e.target.value) || 1)}
                className="bg-transparent text-left text-xs font-mono text-tv-text outline-none mt-1"
              />
            </div>
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-tv-text-muted">Posiciones Máximas</span>
              <InfoBubble text="Límite de posiciones simultáneas que el bot puede mantener abiertas." />
            </div>
            <input
              type="number"
              min="1"
              value={maxPositions}
              onChange={(e) => setMaxPositions(parseInt(e.target.value) || 1)}
              className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-12"
            />
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-tv-text-muted">Pérdida Diaria Máx (%)</span>
              <InfoBubble text="Si la pérdida flotante alcanza este porcentaje del balance, el bot detendrá operaciones y cerrará todas las posiciones de emergencia (Risk Guard)." />
            </div>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={maxDailyLoss}
              onChange={(e) => setMaxDailyLoss(parseFloat(e.target.value) || 1.0)}
              className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-14"
            />
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Sección 3: Filtro Vectorial IA (ChromaDB) */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tv-text-muted uppercase">
            <Sparkles className="h-3.5 w-3.5 text-tv-green animate-pulse" />
            <span>Filtro de Contexto IA</span>
          </div>

          <div className="flex flex-col gap-1 bg-tv-bg border border-zinc-800 rounded-md p-2">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-tv-text-muted font-medium">Umbral Similitud (Chroma)</span>
                <InfoBubble text="Distancia máxima para encontrar escenarios pasados similares. Menor valor requiere mayor similitud (más restrictivo)." />
              </div>
              <span className="text-[9px] font-mono text-tv-green">{chromaThreshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.50"
              max="0.95"
              step="0.01"
              value={chromaThreshold}
              onChange={(e) => setChromaThreshold(parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer mt-1.5 accent-tv-green"
            />
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-tv-text-muted">Top-K Similitudes</span>
              <InfoBubble text="Número de situaciones históricas similares a considerar antes de abrir un trade." />
            </div>
            <input
              type="number"
              min="1"
              max="15"
              value={chromaTopK}
              onChange={(e) => setChromaTopK(parseInt(e.target.value) || 1)}
              className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-12"
            />
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Sección 4: Killzones Operativas */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tv-text-muted uppercase">
            <Clock className="h-3.5 w-3.5 text-tv-amber" />
            <span>Killzones Operativas (UTC)</span>
            <InfoBubble text="El bot solo buscará operaciones durante las sesiones de mercado habilitadas." />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(["asian", "london", "overlap", "newyork"] as KillzoneName[]).map((kz) => (
              <button
                key={kz}
                onClick={() => toggleKillzone(kz)}
                className={cn(
                  "py-1.5 rounded text-[10px] font-semibold uppercase border transition-colors cursor-pointer text-center",
                  killzones[kz]
                    ? "bg-tv-amber/15 text-tv-amber border-tv-amber/50"
                    : "bg-tv-bg/50 text-tv-text-muted border-zinc-800 hover:bg-zinc-900"
                )}
              >
                {kz}
              </button>
            ))}
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Sección 5: Opciones de Gestión de Trades */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tv-text-muted uppercase">
            <Percent className="h-3.5 w-3.5 text-tv-blue" />
            <span>Gestión de Trades</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-tv-text-muted">Trailing Stop</span>
              <InfoBubble text="Mover automáticamente el Stop Loss conforme el precio avanza a favor." />
            </div>
            <input
              type="checkbox"
              checked={trailingStop}
              onChange={(e) => setTrailingStop(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-tv-text-muted">Cierre Parcial</span>
              <InfoBubble text="Cerrar una parte de la posición al alcanzar el punto de equilibrio (EQ) y asegurar a Breakeven." />
            </div>
            <input
              type="checkbox"
              checked={partialClose}
              onChange={(e) => setPartialClose(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          {partialClose && (
            <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-tv-text-muted">Volumen Parcial (%)</span>
                <InfoBubble text="Porcentaje de la posición original que se cerrará en el TP intermedio." />
              </div>
              <input
                type="number"
                min="10"
                max="90"
                value={partialClosePct}
                onChange={(e) => setPartialClosePct(parseInt(e.target.value) || 50)}
                className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-12"
              />
            </div>
          )}
        </div>

        <Separator className="bg-zinc-800" />

        {/* Sección 6: Metodología CRT Institucional */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tv-text-muted uppercase">
            <Sparkles className="h-3.5 w-3.5 text-tv-blue animate-pulse" />
            <span>⚡ METODOLOGÍA CRT INSTITUCIONAL</span>
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Multiplicador TBS</span>
              <InfoBubble text="Multiplicador de riesgo para el setup Turtle Body Soup (cierre de cuerpo + reversión). 1.0 = Riesgo completo." />
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.modelTbsRiskMultiplier ?? 1.0})</span>
            </div>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={modelTbsRiskMultiplier}
              onChange={(e) => setModelTbsRiskMultiplier(parseFloat(e.target.value) || 1.0)}
              className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-16"
            />
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Multiplicador TWS</span>
              <InfoBubble text="Multiplicador de riesgo para el setup Turtle Wick Soup (solo mecha). Menos fiable, por defecto 0.5 = Mitad de riesgo." />
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.modelTwsRiskMultiplier ?? 0.5})</span>
            </div>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={modelTwsRiskMultiplier}
              onChange={(e) => setModelTwsRiskMultiplier(parseFloat(e.target.value) || 0.5)}
              className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-16"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Confluencia Híbrida M1/M15</span>
              <InfoBubble text="Si está activo, exige que el barrido en M1 coincida con una zona clave de liquidez en M15 para mayor fiabilidad." />
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.hybridM1M15Confluence ? "SÍ" : "NO"})</span>
            </div>
            <input
              type="checkbox"
              checked={hybridM1M15Confluence}
              onChange={(e) => setHybridM1M15Confluence(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Filtro Divergencia SMT</span>
              <InfoBubble text="Si está activo, evita pares que sí barrieron un extremo si su par correlacionado inverso (e.g. DXY) no confirmó el movimiento." />
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.smtDivergenceEnabled ? "SÍ" : "NO"})</span>
            </div>
            <input
              type="checkbox"
              checked={smtDivergenceEnabled}
              onChange={(e) => {
                setSmtDivergenceEnabled(e.target.checked);
                setSmtDivergenceCheck(e.target.checked);
              }}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          {/* [CRT-IMPL-6] Nuevos Controles de Metodología */}
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Confirmación por Vela (TBS/TWS)</span>
              <InfoBubble text="Exige confirmación por cierre de vela M1 (Vela 3) para validar y clasificar el sweep." />
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.requireCandleConfirmation ? "SÍ" : "NO"})</span>
            </div>
            <input
              type="checkbox"
              checked={requireCandleConfirmation}
              onChange={(e) => setRequireCandleConfirmation(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Usar SL Dinámico (Vela 2)</span>
              <InfoBubble text="Establece el Stop Loss dinámicamente detrás del extremo de la mecha de la Vela 2 + buffer." />
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.useDynamicSl ? "SÍ" : "NO"})</span>
            </div>
            <input
              type="checkbox"
              checked={useDynamicSl}
              onChange={(e) => setUseDynamicSl(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Usar Objetivos CRT (EQ/Extremo)</span>
              <InfoBubble text="Establece el TP1 en el punto medio de equilibrio (EQ) y el TP2 en el extremo opuesto del rango." />
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.useCrtTargets ? "SÍ" : "NO"})</span>
            </div>
            <input
              type="checkbox"
              checked={useCrtTargets}
              onChange={(e) => setUseCrtTargets(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Cierre Parcial en EQ</span>
              <InfoBubble text="Ejecuta un cierre parcial y asegura a Breakeven al alcanzar la zona de equilibrio (EQ)." />
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.partialCloseAtEq ? "SÍ" : "NO"})</span>
            </div>
            <input
              type="checkbox"
              checked={partialCloseAtEq}
              onChange={(e) => setPartialCloseAtEq(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════
            SECCIÓN: CONTROL DE BYPASS Y MÁRGENES (CAPA 1)
        ═══════════════════════════════════════════════════ */}
        <div className="p-4 flex flex-col gap-4 border-t border-zinc-800">

          {/* Cabecera de sección */}
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tv-text-muted uppercase">
            <Settings className="h-3.5 w-3.5 text-zinc-500" />
            <span>Control de bypass y márgenes</span>
          </div>

          {/* ── Horarios de Killzones ─────────────────────── */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Horarios de sesiones (UTC)
            </span>

            {/* Fila Londres */}
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] text-zinc-300 truncate">🇬🇧 Londres</span>
                <InfoBubble text="Ventana de alta liquidez. Captura el barrido del rango asiático (Asia Sweep). Horario en UTC." />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <input type="time" value={londonStart} onChange={(e) => setLondonStart(e.target.value)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1 border border-zinc-700 outline-none focus:border-tv-blue/60 w-[74px]" />
                <span className="text-zinc-600 text-[10px]">→</span>
                <input type="time" value={londonEnd} onChange={(e) => setLondonEnd(e.target.value)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1 border border-zinc-700 outline-none focus:border-tv-blue/60 w-[74px]" />
              </div>
            </div>

            {/* Fila Nueva York */}
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] text-zinc-300 truncate">🇺🇸 Nueva York</span>
                <InfoBubble text="Incluye el NY Magic Hour (10-11 AM EST) and el Judas Swing (9:30 AM). Mayor volumen del día. Horario en UTC." />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <input type="time" value={newYorkStart} onChange={(e) => setNewYorkStart(e.target.value)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1 border border-zinc-700 outline-none focus:border-tv-blue/60 w-[74px]" />
                <span className="text-zinc-600 text-[10px]">→</span>
                <input type="time" value={newYorkEnd} onChange={(e) => setNewYorkEnd(e.target.value)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1 border border-zinc-700 outline-none focus:border-tv-blue/60 w-[74px]" />
              </div>
            </div>

            {/* Fila Asiática */}
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] text-zinc-300 truncate">🌏 Asiática</span>
                <InfoBubble text="Sesión de baja volatilidad. El rango formado aquí es el objetivo de barrido en la apertura de Londres." />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <input type="time" value={asianStart} onChange={(e) => setAsianStart(e.target.value)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1 border border-zinc-700 outline-none focus:border-tv-blue/60 w-[74px]" />
                <span className="text-zinc-600 text-[10px]">→</span>
                <input type="time" value={asianEnd} onChange={(e) => setAsianEnd(e.target.value)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1 border border-zinc-700 outline-none focus:border-tv-blue/60 w-[74px]" />
              </div>
            </div>
          </div>

          {/* ── Filtro de Spread ──────────────────────────── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-300">Spread máximo</span>
                <InfoBubble text="El bot ignorará señales si el spread del broker supera este valor. Desactívalo para operar en cualquier condición de liquidez (útil en backtesting)." />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={100} step={1}
                  value={maxSpreadPoints}
                  disabled={disableSpreadFilter}
                  onChange={(e) => setMaxSpreadPoints(parseInt(e.target.value) || 20)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1
                             border border-zinc-700 outline-none focus:border-tv-blue/60 w-16 text-right
                             disabled:opacity-30 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-zinc-500">pts</span>
              </div>
            </div>
            <label className="flex items-center gap-2 px-1 cursor-pointer group">
              <input
                type="checkbox" checked={disableSpreadFilter}
                onChange={(e) => setDisableSpreadFilter(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 accent-tv-blue"
              />
              <span className="text-[11px] text-zinc-400 group-hover:text-zinc-200 transition-colors">
                Desactivar filtro de spread
              </span>
              <InfoBubble text="⚠ Riesgo: operar con spread alto puede erosionar el TP. Usar solo en demo o backtesting." />
            </label>
          </div>

          {/* ── Filtro de ATR ─────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-300">ATR mínimo</span>
                <InfoBubble text="Average True Range mínimo en pips. Si la volatilidad de la vela ancla es inferior, el bot descarta la señal para evitar operar en mercado plano." />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={100} step={0.5}
                  value={minAtrPips}
                  disabled={disableAtrFilter}
                  onChange={(e) => setMinAtrPips(parseFloat(e.target.value) || 12)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1
                             border border-zinc-700 outline-none focus:border-tv-blue/60 w-16 text-right
                             disabled:opacity-30 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-zinc-500">pips</span>
              </div>
            </div>
            <label className="flex items-center gap-2 px-1 cursor-pointer group">
              <input
                type="checkbox" checked={disableAtrFilter}
                onChange={(e) => setDisableAtrFilter(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 accent-tv-blue"
              />
              <span className="text-[11px] text-zinc-400 group-hover:text-zinc-200 transition-colors">
                Desactivar filtro de ATR
              </span>
              <InfoBubble text="⚠ Solución directa al rechazo de señales. Desactívalo para observar las señales que el bot detecta sin restricción de volatilidad." />
            </label>
          </div>

          {/* ── Filtro de Mecha CRT ───────────────────────── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-300">Ratio cuerpo/mecha máx.</span>
                <InfoBubble text="Regla CRT: la vela de manipulación (Vela 2) no debe tener un cuerpo mayor a este % del tamaño total. Un valor alto es más permisivo con los TBS." />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={5} max={100} step={5}
                  value={maxWickBodyRatio}
                  disabled={disableWickBodyFilter}
                  onChange={(e) => setMaxWickBodyRatio(parseInt(e.target.value) || 20)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1
                             border border-zinc-700 outline-none focus:border-tv-blue/60 w-16 text-right
                             disabled:opacity-30 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-zinc-500">%</span>
              </div>
            </div>
            <label className="flex items-center gap-2 px-1 cursor-pointer group">
              <input
                type="checkbox" checked={disableWickBodyFilter}
                onChange={(e) => setDisableWickBodyFilter(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 accent-tv-blue"
              />
              <span className="text-[11px] text-zinc-400 group-hover:text-zinc-200 transition-colors">
                Desactivar filtro de mecha CRT
              </span>
              <InfoBubble text="Elimina la regla del 20% de la Metodología CRT. Útil para detectar setups TWS con cuerpo más amplio." />
            </label>
          </div>

          {/* [BYPASS DIMENSIÓN] — Filtro de dimensión de vela ancla H4 */}
          <div className="flex flex-col gap-2">

            {/* Input: Amplitud mínima Forex */}
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800
                            rounded-lg px-3 py-2 opacity-100"
                 style={{ opacity: disableDimensionFilter ? 0.4 : 1 }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-300">Amplitud mínima Forex</span>
                <InfoBubble text="Tamaño mínimo de la vela ancla H4 en porcentaje del precio para pares de divisas (EURUSD, GBPUSD). Si la vela H4 es más pequeña que este valor, se descarta la señal. Valor típico: 0.08%." />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0.01} max={1.0} step={0.01}
                  value={minAmplitudeForexPct}
                  disabled={disableDimensionFilter}
                  onChange={(e) => setMinAmplitudeForexPct(parseFloat(e.target.value) || 0.08)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1
                             border border-zinc-700 outline-none focus:border-tv-blue/60 w-16 text-right
                             disabled:opacity-30 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-zinc-500">%</span>
              </div>
            </div>

            {/* Input: Amplitud mínima Índices */}
            <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800
                            rounded-lg px-3 py-2"
                 style={{ opacity: disableDimensionFilter ? 0.4 : 1 }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-300">Amplitud mínima Índices</span>
                <InfoBubble text="Tamaño mínimo de la vela ancla H4 en puntos para índices bursátiles. Si la vela H4 es más pequeña que este valor, se descarta la señal. Valor típico: 20 puntos." />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={500} step={1}
                  value={minAmplitudeIndicesPoints}
                  disabled={disableDimensionFilter}
                  onChange={(e) => setMinAmplitudeIndicesPoints(parseFloat(e.target.value) || 20.0)}
                  className="bg-zinc-800 text-zinc-300 text-[11px] font-mono rounded px-2 py-1
                             border border-zinc-700 outline-none focus:border-tv-blue/60 w-16 text-right
                             disabled:opacity-30 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-zinc-500">pts</span>
              </div>
            </div>

            {/* Toggle: Desactivar filtro completo */}
            <label className="flex items-center gap-2 px-1 cursor-pointer group">
              <input
                type="checkbox"
                checked={disableDimensionFilter}
                onChange={(e) => setDisableDimensionFilter(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 accent-tv-blue"
              />
              <span className="text-[11px] text-zinc-400 group-hover:text-zinc-200 transition-colors">
                Desactivar filtro de dimensión
              </span>
              <InfoBubble text="Elimina la validación del tamaño mínimo de la vela H4. Útil en mercados lentos o en consolidación donde las velas son pequeñas pero el setup CRT es válido. Los inputs de amplitud se ignorarán." />
            </label>

          </div>

        </div>

        {/* Botón de Aplicar */}
        <div className="p-4 mt-auto border-t border-zinc-800 bg-zinc-900/30">
          <Button
            onClick={handleApply}
            className="w-full h-11 bg-tv-blue text-white hover:bg-tv-blue/90 font-bold transition-all text-xs border-0 shadow-md flex items-center justify-center gap-2 cursor-pointer"
          >
            APLICAR CONFIGURACIÓN
          </Button>
        </div>
      </div>
    </div>
  );
}
