import React, { memo } from "react";
import { ClosedTrade } from "@/lib/store/trading-store";

function formatTime(timestamp: number) {
  const d = new Date(timestamp * 1000);
  return d.toLocaleString("es-ES", { 
    month: 'short', day: '2-digit', 
    hour: '2-digit', minute: '2-digit', second: '2-digit' 
  });
}

const safeNum = (val: unknown, decimals = 2): string => {
  const n = Number(val);
  return isNaN(n) ? "—" : n.toFixed(decimals);
};

export const HistoryRow = memo(({ trade }: { trade: ClosedTrade }) => {
  const isBuy = trade.type === "buy";
  const isWin = trade.pnl >= 0;

  return (
    <tr className="border-b border-zinc-800/30 hover:bg-zinc-800/10 transition-colors">
      <td className="px-4 py-2 font-mono text-xs text-zinc-500">#{trade.ticket}</td>
      <td className="px-4 py-2 text-zinc-300">{formatTime(trade.close_time)}</td>
      <td className="px-4 py-2 text-zinc-100 font-medium">{trade.symbol}</td>
      <td className="px-4 py-2">
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
          isBuy ? "bg-emerald-500/10 text-emerald-400" : "bg-tv-red/10 text-tv-red"
        }`}>
          {trade.type.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-2 text-zinc-400">{safeNum((trade as any).volume ?? (trade as any).lots, 2)}</td>
      <td className="px-4 py-2 font-mono text-zinc-400">{safeNum((trade as any).open_price ?? (trade as any).price_open ?? (trade as any).entry, 5)}</td>
      <td className="px-4 py-2 font-mono text-zinc-400">{safeNum((trade as any).close_price ?? (trade as any).price_close ?? (trade as any).exit, 5)}</td>
      <td className={`px-4 py-2 font-mono text-right text-sm font-medium ${
        isWin ? "text-emerald-400" : "text-tv-red"
      }`}>
        {isWin ? "+" : ""}{safeNum((trade as any).pnl ?? (trade as any).profit, 2)}
      </td>
    </tr>
  );
});
