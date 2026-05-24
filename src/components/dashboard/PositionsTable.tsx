"use client";

import { useTradingStore } from "@/lib/store/trading-store";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { closePositionOnBridge, modifyPosition } from "@/lib/data/mock-feed";

export function PositionsTable() {
  const { positions } = useTradingStore();

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
      <div className="grid grid-cols-[70px_1fr_50px_50px_80px_90px_90px_80px_60px] gap-2 border-b border-tv-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-tv-text-dim">
        <span>ID</span>
        <span>Símbolo</span>
        <span>Tipo</span>
        <span className="text-right">Lote</span>
        <span className="text-right">Entrada</span>
        <span className="text-right">Stop Loss</span>
        <span className="text-right">Take Profit</span>
        <span className="text-right">PnL</span>
        <span className="text-right">Acción</span>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {positions.map((pos) => (
            <div
              key={pos.id}
              className="group grid grid-cols-[70px_1fr_50px_50px_80px_90px_90px_80px_60px] items-center gap-2 border-b border-tv-border/50 px-3 py-1.5 text-xs transition-colors hover:bg-tv-panel-hover"
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
              
              {/* SL Input */}
              <div className="px-1">
                <input
                  key={pos.id + "_sl_" + (pos.sl || 0)}
                  type="number"
                  step="0.00001"
                  defaultValue={pos.sl || 0}
                  onBlur={(e) => {
                    const newVal = parseFloat(e.target.value) || 0;
                    if (newVal !== (pos.sl || 0)) {
                      modifyPosition(pos.ticket || parseInt(pos.id), pos.tp || 0, newVal);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full bg-tv-bg/50 border border-tv-border/50 hover:border-tv-border rounded px-1 py-0.5 text-right font-mono text-xs text-tv-text outline-none focus:border-tv-blue transition-all"
                />
              </div>

              {/* TP Input */}
              <div className="px-1">
                <input
                  key={pos.id + "_tp_" + (pos.tp || 0)}
                  type="number"
                  step="0.00001"
                  defaultValue={pos.tp || 0}
                  onBlur={(e) => {
                    const newVal = parseFloat(e.target.value) || 0;
                    if (newVal !== (pos.tp || 0)) {
                      modifyPosition(pos.ticket || parseInt(pos.id), newVal, pos.sl || 0);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full bg-tv-bg/50 border border-tv-border/50 hover:border-tv-border rounded px-1 py-0.5 text-right font-mono text-xs text-tv-text outline-none focus:border-tv-blue transition-all"
                />
              </div>

              <span className={cn(
                "text-right font-bold tabular-nums",
                pos.pnl >= 0 ? "text-tv-green" : "text-tv-red"
              )}>
                {pos.pnl >= 0 ? "+" : ""}{formatPrice(pos.pnl)}
              </span>
              
              <div className="flex justify-end pr-1">
                <button
                  onClick={() => {
                    const ticket = pos.ticket || parseInt(pos.id);
                    if (ticket) {
                      closePositionOnBridge(ticket);
                    }
                  }}
                  className="invisible rounded p-1 text-tv-text-muted hover:bg-tv-bg hover:text-tv-red group-hover:visible transition-colors"
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
