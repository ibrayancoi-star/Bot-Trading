"use client";

import { useTradingStore } from "@/lib/store/trading-store";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Brain,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from "lucide-react";
import { useState } from "react";

function formatTimestamp(ts: number): string {
  if (!ts) return "—";
  const date = new Date(ts * 1000 > 1e14 ? ts : ts * 1000);
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TradeRow({
  trade,
}: {
  trade: {
    id: string;
    document: string;
    metadata: {
      type: string;
      title: string;
      symbol: string;
      trade_type: string;
      outcome: string;
      pips_result: number;
      spread: number;
      setup_initial: string;
      timestamp: number;
      source?: string;
    };
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const { metadata, document: doc } = trade;
  const isProfit = metadata.outcome === "PROFIT";
  const isBuy = metadata.trade_type === "BUY";

  return (
    <div
      className={cn(
        "group border-b border-tv-border/40 transition-colors hover:bg-tv-panel-hover"
      )}
    >
      {/* Main row */}
      <div
        className="grid grid-cols-[minmax(90px,1fr)_60px_80px_80px_60px_36px] items-center gap-2 px-3 py-2 text-xs cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Symbol + Setup */}
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded",
              isProfit
                ? "bg-tv-green/15 text-tv-green"
                : "bg-tv-red/15 text-tv-red"
            )}
          >
            {isProfit ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-bold text-tv-text block truncate">
              {metadata.symbol}
            </span>
            <span className="text-[10px] text-tv-text-dim truncate block">
              {metadata.setup_initial || metadata.title}
            </span>
          </div>
        </div>

        {/* Type (BUY/SELL) */}
        <span
          className={cn(
            "font-semibold text-center",
            isBuy ? "text-tv-green" : "text-tv-red"
          )}
        >
          {metadata.trade_type}
        </span>

        {/* Pips Result */}
        <span
          className={cn(
            "text-right font-bold tabular-nums",
            isProfit ? "text-tv-green" : "text-tv-red"
          )}
        >
          {isProfit ? "+" : ""}
          {metadata.pips_result?.toFixed(1) ?? "0.0"} pips
        </span>

        {/* Spread */}
        <span className="text-right font-mono text-tv-text-dim tabular-nums">
          {metadata.spread?.toFixed(1) ?? "—"} pts
        </span>

        {/* Timestamp */}
        <span className="text-right text-[10px] text-tv-text-dim whitespace-nowrap hidden xl:block">
          {formatTimestamp(metadata.timestamp)}
        </span>

        {/* Expand toggle */}
        <div className="flex justify-center text-tv-text-dim">
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </div>

      {/* Expanded insight */}
      {expanded && doc && (
        <div className="px-3 pb-3 pt-0">
          <div className="rounded-md border border-tv-border/40 bg-tv-bg/60 p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Brain className="h-3 w-3 text-tv-blue" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-tv-blue">
                Análisis del Feedback Loop
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-tv-text-muted whitespace-pre-line">
              {doc}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoryPanel() {
  const { historicalTrades } = useTradingStore();

  if (historicalTrades.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-tv-text-dim">
        <BarChart3 className="h-6 w-6 opacity-40" />
        <span className="text-xs italic">
          Sin historial de operaciones registrado
        </span>
        <span className="text-[10px] opacity-60">
          Las operaciones cerradas aparecerán aquí automáticamente
        </span>
      </div>
    );
  }

  // Stats summary
  const total = historicalTrades.length;
  const wins = historicalTrades.filter(
    (t) => t.metadata.outcome === "PROFIT"
  ).length;
  const losses = total - wins;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0";
  const totalPips = historicalTrades.reduce(
    (sum, t) => sum + (t.metadata.pips_result || 0),
    0
  );

  return (
    <div className="flex h-full flex-col">
      {/* Stats bar */}
      <div className="flex items-center gap-4 border-b border-tv-border/60 px-3 py-1.5 text-[10px]">
        <div className="flex items-center gap-1.5">
          <BarChart3 className="h-3 w-3 text-tv-text-dim" />
          <span className="text-tv-text-muted font-medium">
            {total} operaciones
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-tv-green font-semibold">{wins}W</span>
          <span className="text-tv-text-dim">/</span>
          <span className="text-tv-red font-semibold">{losses}L</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-tv-text-dim">WR:</span>
          <span
            className={cn(
              "font-bold",
              parseFloat(winRate) >= 50 ? "text-tv-green" : "text-tv-red"
            )}
          >
            {winRate}%
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-tv-text-dim">Net:</span>
          <span
            className={cn(
              "font-bold tabular-nums",
              totalPips >= 0 ? "text-tv-green" : "text-tv-red"
            )}
          >
            {totalPips >= 0 ? "+" : ""}
            {totalPips.toFixed(1)} pips
          </span>
        </div>
      </div>

      {/* Header */}
      <div className="grid grid-cols-[minmax(90px,1fr)_60px_80px_80px_60px_36px] gap-2 border-b border-tv-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-tv-text-dim">
        <span>Símbolo / Setup</span>
        <span className="text-center">Tipo</span>
        <span className="text-right">Resultado</span>
        <span className="text-right">Spread</span>
        <span className="text-right hidden xl:block">Fecha</span>
        <span />
      </div>

      {/* Trades list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {historicalTrades.map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
