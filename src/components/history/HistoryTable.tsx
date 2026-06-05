"use client";

import React from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { HistoryRow } from "./HistoryRow";

export function HistoryTable() {
  const tradeHistory = useTradingStore((s) => s.tradeHistory);

  if (!tradeHistory || tradeHistory.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        No hay historial disponible
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/50 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-3 font-medium">Ticket</th>
            <th className="px-4 py-3 font-medium">Close Time</th>
            <th className="px-4 py-3 font-medium">Symbol</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Size</th>
            <th className="px-4 py-3 font-medium">Entry</th>
            <th className="px-4 py-3 font-medium">Close</th>
            <th className="px-4 py-3 font-medium text-right">PnL</th>
          </tr>
        </thead>
        <tbody>
          {tradeHistory.map((t) => (
            <HistoryRow key={`${(t as any).ticket ?? (t as any).id ?? (t as any).order}-${(t as any).close_time ?? (t as any).time ?? Math.random()}`} trade={t} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
