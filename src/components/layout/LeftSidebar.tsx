"use client";

import { useState, useEffect } from "react";
import { useTradingStore, type BotConfig, type Strategy, type KillzoneName } from "@/lib/store/trading-store";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Settings, Shield, Zap, Sparkles, Clock, Percent, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function LeftSidebar() {
  const isLeftSidebarOpen = useTradingStore((s) => s.isLeftSidebarOpen);
  const toggleLeftSidebar = useTradingStore((s) => s.toggleLeftSidebar);
  const botConfig = useTradingStore((s) => s.botConfig);
  const setBotConfig = useTradingStore((s) => s.setBotConfig);

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

  // Dragging states
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Sincronizar estado local al cargar o cambiar el config del store
  useEffect(() => {
    if (botConfig) {
      setStrategy(botConfig.strategy);
      setLotSize(botConfig.lotSize);
      setTakeProfitPips(botConfig.takeProfitPips);
      setStopLossPips(botConfig.stopLossPips);
      setMaxPositions(botConfig.maxPositions);
      setMaxDailyLoss(botConfig.maxDailyLoss);
      setChromaThreshold(botConfig.chromaThreshold);
      setChromaTopK(botConfig.chromaTopK);
      setKillzones(botConfig.killzones);
      setTrailingStop(botConfig.trailingStop);
      setPartialClose(botConfig.partialClose);
      setPartialClosePct(botConfig.partialClosePct);
      if (botConfig.modelTbsRiskMultiplier !== undefined) setModelTbsRiskMultiplier(botConfig.modelTbsRiskMultiplier);
      if (botConfig.modelTwsRiskMultiplier !== undefined) setModelTwsRiskMultiplier(botConfig.modelTwsRiskMultiplier);
      if (botConfig.hybridM1M15Confluence !== undefined) setHybridM1M15Confluence(botConfig.hybridM1M15Confluence);
      if (botConfig.smtDivergenceCheck !== undefined) setSmtDivergenceCheck(botConfig.smtDivergenceCheck);
    }
  }, [botConfig]);

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

          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-tv-text-muted">Estrategia Activa</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as Strategy)}
              className="w-full bg-tv-bg border border-zinc-800 rounded-md px-3 py-2 text-xs font-medium outline-none text-tv-text cursor-pointer hover:bg-zinc-900"
            >
              <option value="scalping">Scalping (Veloz / Alta Frecuencia)</option>
              <option value="swing">Swing (Medio Plazo / H4)</option>
              <option value="breakout">Breakout (Rupturas / Canales)</option>
              <option value="reversal">Reversal (H4 Sweep / Liquidez)</option>
            </select>
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <span className="text-[11px] text-tv-text-muted">Lotaje Base</span>
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
              <span className="text-[9px] text-tv-text-muted">Take Profit (Pips)</span>
              <input
                type="number"
                min="1"
                value={takeProfitPips}
                onChange={(e) => setTakeProfitPips(parseInt(e.target.value) || 1)}
                className="bg-transparent text-left text-xs font-mono text-tv-text outline-none mt-1"
              />
            </div>
            <div className="flex flex-col gap-1 bg-tv-bg border border-zinc-800 rounded-md p-2">
              <span className="text-[9px] text-tv-text-muted">Stop Loss (Pips)</span>
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
            <span className="text-[11px] text-tv-text-muted">Posiciones Máximas</span>
            <input
              type="number"
              min="1"
              value={maxPositions}
              onChange={(e) => setMaxPositions(parseInt(e.target.value) || 1)}
              className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-12"
            />
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <span className="text-[11px] text-tv-text-muted">Pérdida Diaria Máx (%)</span>
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
              <span className="text-[9px] text-tv-text-muted font-medium">Umbral Similitud (Chroma)</span>
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
            <span className="text-[11px] text-tv-text-muted">Top-K Similitudes</span>
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
            <span className="text-[11px] text-tv-text-muted">Trailing Stop</span>
            <input
              type="checkbox"
              checked={trailingStop}
              onChange={(e) => setTrailingStop(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-tv-text-muted">Cierre Parcial</span>
            <input
              type="checkbox"
              checked={partialClose}
              onChange={(e) => setPartialClose(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
          </div>

          {partialClose && (
            <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
              <span className="text-[11px] text-tv-text-muted">Volumen Parcial (%)</span>
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
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.smtDivergenceCheck ? "SÍ" : "NO"})</span>
            </div>
            <input
              type="checkbox"
              checked={smtDivergenceCheck}
              onChange={(e) => setSmtDivergenceCheck(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-tv-blue rounded border-zinc-800 bg-tv-bg"
            />
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
