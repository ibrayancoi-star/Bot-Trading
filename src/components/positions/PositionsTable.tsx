"use client";

import React, { useCallback } from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { PositionRow } from "./PositionRow";
import { sendClosePosition } from "@/lib/data/mock-feed";

export function PositionsTable() {
  const positions = useTradingStore((s) => s.positions);

  const handleClose = useCallback((ticket: number) => {
    sendClosePosition(ticket);
  }, []);

  if (!positions || positions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        No hay posiciones abiertas
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/50 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-3 font-medium">Ticket</th>
            <th className="px-4 py-3 font-medium">Symbol</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Size</th>
            <th className="px-4 py-3 font-medium">Entry</th>
            <th className="px-4 py-3 font-medium">Current</th>
            <th className="px-4 py-3 font-medium">SL / TP</th>
            <th className="px-4 py-3 font-medium text-right">PnL</th>
            <th className="px-4 py-3 font-medium text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => (
            <PositionRow 
              key={pos.ticket} 
              pos={pos} 
              onClose={handleClose} 
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
