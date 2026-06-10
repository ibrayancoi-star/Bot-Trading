import { memo } from "react";

// [HISTORY-FIX-1] Renderiza una fila del historial real de MT5
const safeNum = (val: unknown, decimals = 2): string => {
  const n = Number(val);
  return isNaN(n) ? "—" : n.toFixed(decimals);
};

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatCloseTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

const ORIGIN_BADGE: Record<string, { label: string; cls: string }> = {
  bot:         { label: "BOT",     cls: "bg-blue-500/10 text-blue-400" },
  bot_partial: { label: "PARCIAL", cls: "bg-amber-500/10 text-amber-400" },
  manual:      { label: "MANUAL",  cls: "bg-zinc-500/10 text-zinc-400" },
};

export const HistoryRow = memo(({ trade }: { trade: any }) => {
  const isBuy = (trade.direction ?? trade.type ?? "").toString().toUpperCase() === "BUY";
  const pips = Number(trade.pips ?? 0);
  const net = Number(trade.net_profit ?? trade.pnl ?? trade.profit ?? 0);
  const origin = (trade.origin ?? "manual") as string;
  const badge = ORIGIN_BADGE[origin] ?? ORIGIN_BADGE.manual;

  return (
    <tr className="border-b border-zinc-800/30 hover:bg-zinc-800/10 transition-colors">
      <td className="px-4 py-2 font-mono text-xs text-zinc-500">#{trade.ticket}</td>
      <td className="px-4 py-2 text-zinc-100 font-medium">{trade.symbol}</td>
      <td className="px-4 py-2">
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
          isBuy ? "bg-emerald-500/10 text-emerald-400" : "bg-tv-red/10 text-tv-red"
        }`}>
          {isBuy ? "BUY" : "SELL"}
        </span>
      </td>
      <td className="px-4 py-2 text-zinc-400">{safeNum(trade.volume, 2)}</td>
      <td className="px-4 py-2 font-mono text-zinc-400">{safeNum(trade.open_price, 5)}</td>
      <td className="px-4 py-2 font-mono text-zinc-400">{safeNum(trade.close_price, 5)}</td>
      <td className={`px-4 py-2 font-mono text-right ${pips >= 0 ? "text-emerald-400" : "text-tv-red"}`}>
        {pips >= 0 ? "+" : ""}{safeNum(pips, 1)}
      </td>
      <td className={`px-4 py-2 font-mono text-right font-medium ${net >= 0 ? "text-emerald-400" : "text-tv-red"}`}>
        {net >= 0 ? "+" : ""}{safeNum(net, 2)}
      </td>
      <td className="px-4 py-2 font-mono text-zinc-400">{formatDuration(trade.duration_s)}</td>
      <td className="px-4 py-2">
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${badge.cls}`}>
          {badge.label}
        </span>
      </td>
      <td className="px-4 py-2 text-zinc-300">{formatCloseTime(trade.close_time)}</td>
    </tr>
  );
});

HistoryRow.displayName = "HistoryRow";
