"use client";

import { useState } from "react";
import { useBacktestStore } from "@/lib/store/backtest-store";
import { startBacktest, stopBacktest, startDataReplay, stopDataReplay } from "@/lib/data/backtest-feed";
import { Button } from "@/components/ui/button";
import { Play, Square, RotateCcw, Calendar, Shield, Sparkles, Sliders } from "lucide-react";

export function BacktestPanel() {
  const { isRunning, progress, status, errorMessage, clearBacktest, timeframe, setTimeframe } = useBacktestStore();

  const [symbol, setSymbol] = useState("EURUSD");
  const [from, setFrom] = useState("2026-05-01");
  const [to, setTo] = useState("2026-06-01");

  // Strategy Parameters
  const [lotSize, setLotSize] = useState(0.1);
  const [takeProfitPips, setTakeProfitPips] = useState(20);
  const [stopLossPips, setStopLossPips] = useState(15);
  const [chromaThreshold, setChromaThreshold] = useState(0.72);
  const [chromaTopK, setChromaTopK] = useState(5);
  
  // Replay State
  const [replaySpeed, setReplaySpeed] = useState(100);

  const handleStart = () => {
    startBacktest({
      symbol,
      timeframe,
      from,
      to,
      config: {
        lotSize,
        takeProfitPips,
        stopLossPips,
        chromaThreshold,
        chromaTopK,
        killzones: { asian: false, london: true, overlap: true, newyork: false },
        londonStart: "07:00",
        londonEnd: "10:00",
        newYorkStart: "12:00",
        newYorkEnd: "15:00",
        asianStart: "02:00",
        asianEnd: "05:00",
        maxSpreadPoints: 20,
        disableSpreadFilter: true, // typical for backtests
        minAtrPips: 12,
        disableAtrFilter: false,
        maxWickBodyRatio: 20,
        disableWickBodyFilter: false,
        disableDimensionFilter: false,
        minAmplitudeForexPct: 0.08,
        minAmplitudeIndicesPoints: 20.0
      }
    });
  };

  const handleStartReplay = () => {
    startDataReplay({
      symbol,
      timeframe,
      from,
      to,
      speed: replaySpeed,
    });
  };

  const handleStop = () => {
    stopBacktest();
    stopDataReplay();
  };

  const handleClear = () => {
    clearBacktest();
  };

  const percentComplete = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div className="flex h-full w-64 flex-col border-r border-tv-border bg-tv-panel text-tv-text text-xs overflow-y-auto">
      <div className="p-4 border-b border-tv-border bg-tv-bg/50">
        <h3 className="font-semibold uppercase tracking-wider text-tv-text-muted">
          Parámetros de Backtesting
        </h3>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Symbol & Timeframe */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase font-bold text-tv-text-muted">Símbolo</label>
          <select
            value={symbol}
            disabled={isRunning}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-tv-bg border border-tv-border rounded px-2.5 py-1.5 outline-none hover:bg-tv-panel-hover cursor-pointer"
          >
            <option value="EURUSD">EURUSD</option>
            <option value="GBPUSD">GBPUSD</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase font-bold text-tv-text-muted">Temporalidad {isRunning && <span className="text-tv-blue normal-case">(en vivo)</span>}</label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="w-full bg-tv-bg border border-tv-border rounded px-2.5 py-1.5 outline-none hover:bg-tv-panel-hover cursor-pointer"
          >
            <option value="1m">1m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
          </select>
        </div>

        {/* Date Ranges */}
        <div className="flex flex-col gap-2 bg-tv-bg/40 border border-tv-border rounded p-3">
          <div className="flex items-center gap-1.5 text-tv-text-muted font-bold text-[10px] uppercase">
            <Calendar className="h-3.5 w-3.5 text-tv-blue" />
            <span>Rango de Fechas</span>
          </div>

          <div className="flex flex-col gap-1.5 mt-1">
            <span className="text-[9px] text-tv-text-muted">Desde</span>
            <input
              type="date"
              value={from}
              disabled={isRunning}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-tv-bg border border-tv-border rounded px-2 py-1 outline-none font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] text-tv-text-muted">Hasta</span>
            <input
              type="date"
              value={to}
              disabled={isRunning}
              onChange={(e) => setTo(e.target.value)}
              className="bg-tv-bg border border-tv-border rounded px-2 py-1 outline-none font-mono"
            />
          </div>
        </div>

        {/* Strategy parameters */}
        <div className="flex flex-col gap-3 bg-tv-bg/40 border border-tv-border rounded p-3">
          <div className="flex items-center gap-1.5 text-tv-text-muted font-bold text-[10px] uppercase">
            <Sliders className="h-3.5 w-3.5 text-tv-amber" />
            <span>Configuración Bot</span>
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-tv-border rounded px-2 py-1.5">
            <span className="text-tv-text-muted text-[10px]">Lotes</span>
            <input
              type="number"
              step="0.01"
              value={lotSize}
              disabled={isRunning}
              onChange={(e) => setLotSize(parseFloat(e.target.value) || 0.01)}
              className="bg-transparent text-right outline-none w-14 font-mono font-bold"
            />
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-tv-border rounded px-2 py-1.5">
            <span className="text-tv-text-muted text-[10px]">Take Profit (Pips)</span>
            <input
              type="number"
              value={takeProfitPips}
              disabled={isRunning}
              onChange={(e) => setTakeProfitPips(parseInt(e.target.value) || 1)}
              className="bg-transparent text-right outline-none w-14 font-mono font-bold"
            />
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-tv-border rounded px-2 py-1.5">
            <span className="text-tv-text-muted text-[10px]">Stop Loss (Pips)</span>
            <input
              type="number"
              value={stopLossPips}
              disabled={isRunning}
              onChange={(e) => setStopLossPips(parseInt(e.target.value) || 1)}
              className="bg-transparent text-right outline-none w-14 font-mono font-bold"
            />
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-tv-border rounded px-2 py-1.5">
            <span className="text-tv-text-muted text-[10px]">Chroma Umbral</span>
            <input
              type="number"
              step="0.01"
              value={chromaThreshold}
              disabled={isRunning}
              onChange={(e) => setChromaThreshold(parseFloat(e.target.value) || 0.72)}
              className="bg-transparent text-right outline-none w-14 font-mono font-bold"
            />
          </div>
        </div>

        {/* Speed Selector */}
        <div className="flex flex-col gap-1.5 bg-tv-bg/40 border border-tv-border rounded p-3">
          <label className="text-[10px] uppercase font-bold text-tv-text-muted">Velocidad Replay</label>
          <select
            value={replaySpeed}
            disabled={isRunning}
            onChange={(e) => setReplaySpeed(Number(e.target.value))}
            className="w-full bg-tv-bg border border-tv-border rounded px-2.5 py-1.5 outline-none hover:bg-tv-panel-hover cursor-pointer"
          >
            <option value="1">1x (Tiempo Real)</option>
            <option value="10">10x</option>
            <option value="50">50x</option>
            <option value="100">100x</option>
            <option value="500">500x</option>
            <option value="1000">1000x</option>
            <option value="5000">5000x</option>
          </select>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col gap-2 mt-1">
          {!isRunning ? (
            <>
              <Button
                onClick={handleStart}
                className="w-full h-10 bg-tv-blue hover:bg-tv-blue/90 text-white font-bold flex items-center justify-center gap-2"
              >
                <Play className="h-4 w-4" />
                INICIAR BACKTEST
              </Button>
              <Button
                onClick={handleStartReplay}
                className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2"
              >
                <Play className="h-4 w-4" />
                REPRODUCIR DATOS (TICKS)
              </Button>
            </>
          ) : (
            <Button
              onClick={handleStop}
              className="w-full h-10 bg-tv-red hover:bg-tv-red/90 text-white font-bold flex items-center justify-center gap-2"
            >
              <Square className="h-4 w-4" />
              DETENER
            </Button>
          )}

          <Button
            onClick={handleClear}
            disabled={isRunning}
            className="w-full h-9 bg-tv-bg border border-tv-border text-tv-text-muted hover:bg-tv-panel-hover flex items-center justify-center gap-2"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            LIMPIAR
          </Button>
        </div>

        {/* Progress Bar */}
        {isRunning && (
          <div className="flex flex-col gap-1.5 bg-tv-bg/50 border border-tv-border rounded p-3 mt-1">
            <div className="flex justify-between text-[10px] text-tv-text-muted">
              <span>Procesando velas...</span>
              <span className="font-mono">{progress.current}/{progress.total}</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-tv-blue h-full transition-all duration-150"
                style={{ width: `${percentComplete}%` }}
              />
            </div>
          </div>
        )}

        {/* Error messaging */}
        {status === "error" && errorMessage && (
          <div className="bg-tv-red/15 border border-tv-red/30 text-tv-red rounded p-3 leading-snug">
            <span className="font-bold">Error:</span> {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
