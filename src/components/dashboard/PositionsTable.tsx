"use client";

import { useTradingStore } from "@/lib/store/trading-store";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export function PositionsTable() {
  const { positions, closePosition } = useTradingStore();

  if (positions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-tv-text-dim italic">
        No hay posiciones abiertas
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="grid grid-cols-[80px_1fr_60px_60px_100px_100px_40px] gap-2 border-b border-tv-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-tv-text-dim">
        <span>ID</span>
        <span>Símbolo</span>
        <span>Tipo</span>
        <span className="text-right">Lote</span>
        <span className="text-right">Entrada</span>
        <span className="text-right">PnL</span>
        <span />
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {positions.map((pos) => (
            <div
              key={pos.id}
              className="group grid grid-cols-[80px_1fr_60px_60px_100px_100px_40px] items-center gap-2 border-b border-tv-border/50 px-3 py-2 text-xs transition-colors hover:bg-tv-panel-hover"
            >
              <span className="font-mono text-[10px] text-tv-text-dim">{pos.id}</span>
              <span className="font-bold text-tv-text">{pos.symbol}</span>
              <span className={cn(
                "font-semibold",
                pos.type === "BUY" ? "text-tv-green" : "text-tv-red"
              )}>
                {pos.type}
              </span>
              <span className="text-right font-medium tabular-nums">{pos.lotSize.toFixed(2)}</span>
              <span className="text-right font-medium tabular-nums text-tv-text-muted">
                {formatPrice(pos.entryPrice)}
              </span>
              <span className={cn(
                "text-right font-bold tabular-nums",
                pos.pnl >= 0 ? "text-tv-green" : "text-tv-red"
              )}>
                {pos.pnl >= 0 ? "+" : ""}{formatPrice(pos.pnl)}
              </span>
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    const result = {
                      id: pos.id,
                      symbol: pos.symbol,
                      type: pos.type,
                      entryPrice: pos.entryPrice,
                      exitPrice: pos.currentPrice,
                      lotSize: pos.lotSize,
                      pnl: pos.pnl,
                      pnlPercentage: (pos.pnl / (pos.entryPrice * pos.lotSize)) * 100, // Simple calc
                      duration: 0,
                      closedAt: Date.now(),
                    };
                    closePosition(pos.id, result);
                  }}
                  className="invisible rounded p-1 text-tv-text-muted hover:bg-tv-bg hover:text-tv-red group-hover:visible"
                  title="Cerrar posición"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
