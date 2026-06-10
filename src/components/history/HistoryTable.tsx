"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { HistoryRow } from "./HistoryRow";

// [HISTORY-FIX-2] Tarjeta de métrica
function MetricCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const color = positive === undefined ? "text-zinc-100" : positive ? "text-emerald-400" : "text-tv-red";
  return (
    <div className="flex flex-col px-3 py-2 rounded bg-zinc-900/50 border border-zinc-800/40 min-w-[90px]">
      <span className={`text-base font-semibold ${color}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
    </div>
  );
}

export function HistoryTable() {
  const tradeHistory = useTradingStore((s) => s.tradeHistory) as any[];
  const tradeMetrics = useTradingStore((s) => s.tradeMetrics);

  const [filter, setFilter] = useState<"all" | "bot" | "manual">("all");
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedTxt, setCopiedTxt] = useState(false);

  const filtered = filter === "all"
    ? tradeHistory
    : tradeHistory.filter((t) =>
        filter === "bot"
          ? (t.origin === "bot" || t.origin === "bot_partial")
          : t.origin === "manual"
      );

  // [HISTORY-FIX-3] Copiar JSON compacto para IA
  const handleCopyJson = () => {
    const data = {
      _fmt: "crt-bot-export-v1",
      _ts: new Date().toISOString(),
      summary: tradeMetrics,
      trades: tradeHistory.map((t) => ({
        tk: t.ticket, sym: t.symbol, dir: t.direction, vol: t.volume,
        op: t.open_price, cp: t.close_price, ot: t.open_time, ct: t.close_time,
        dur: t.duration_s, pnl: t.net_profit, pips: t.pips, orig: t.origin,
        sl: t.sl, tp: t.tp, crt: t.crt_meta || {},
      })),
    };
    navigator.clipboard.writeText(JSON.stringify(data));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  // [HISTORY-FIX-3] Copiar resumen en texto plano
  const handleCopyTxt = () => {
    const m = tradeMetrics;
    if (!m) return;
    const txt =
      `CRT Bot — Resumen\n` +
      `Trades: ${m.total} (Bot: ${m.bot_trades})\n` +
      `WR: ${m.win_rate}%\n` +
      `PF: ${m.profit_factor}\n` +
      `P/L: $${m.total_profit}\n` +
      `TBS: ${m.tbs_count} (${m.tbs_wr}% WR)\n` +
      `TWS: ${m.tws_count} (${m.tws_wr}% WR)`;
    navigator.clipboard.writeText(txt);
    setCopiedTxt(true);
    setTimeout(() => setCopiedTxt(false), 2000);
  };

  const tabBtn = (key: "all" | "bot" | "manual", label: string) => (
    <button
      onClick={() => setFilter(key)}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        filter === key
          ? "bg-zinc-700 text-zinc-100"
          : "bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800/70"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* [HISTORY-FIX-2] Tarjetas de métricas */}
      {tradeMetrics && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-zinc-800/40">
          <MetricCard label="Win Rate" value={`${tradeMetrics.win_rate}%`} positive={tradeMetrics.win_rate >= 50} />
          <MetricCard label="Profit Factor" value={`${tradeMetrics.profit_factor}`} positive={tradeMetrics.profit_factor >= 1} />
          <MetricCard label="Total P/L" value={`$${tradeMetrics.total_profit}`} positive={tradeMetrics.total_profit >= 0} />
          <MetricCard label="Pips" value={`${tradeMetrics.total_pips}`} positive={tradeMetrics.total_pips >= 0} />
          <MetricCard label="TBS WR" value={`${tradeMetrics.tbs_wr}%`} positive={tradeMetrics.tbs_wr >= 50} />
          <MetricCard label="TWS WR" value={`${tradeMetrics.tws_wr}%`} positive={tradeMetrics.tws_wr >= 50} />
        </div>
      )}

      {/* [HISTORY-FIX-1/3] Filtros + botones de exportación */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/40">
        <div className="flex gap-2">
          {tabBtn("all", "Todos")}
          {tabBtn("bot", "Bot")}
          {tabBtn("manual", "Manual")}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopyJson}
            className="px-3 py-1 rounded text-xs font-medium bg-blue-600/80 hover:bg-blue-600 text-white transition-colors"
          >
            {copiedJson ? "Copiado ✓" : "Copiar para IA"}
          </button>
          <button
            onClick={handleCopyTxt}
            disabled={!tradeMetrics}
            className="px-3 py-1 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copiedTxt ? "Copiado ✓" : "Copiar resumen"}
          </button>
        </div>
      </div>

      {/* Tabla */}
      {!filtered || filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
          No hay historial disponible
        </div>
      ) : (
        <div className="overflow-y-auto overflow-x-auto flex-1 min-h-0">
          <table className="w-full min-w-max text-sm text-left">
            <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/50 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-4 py-3 font-medium">Símbolo</th>
                <th className="px-4 py-3 font-medium">Dir</th>
                <th className="px-4 py-3 font-medium">Vol</th>
                <th className="px-4 py-3 font-medium">P.Apertura</th>
                <th className="px-4 py-3 font-medium">P.Cierre</th>
                <th className="px-4 py-3 font-medium text-right">Pips</th>
                <th className="px-4 py-3 font-medium text-right">P/L Neto</th>
                <th className="px-4 py-3 font-medium">Duración</th>
                <th className="px-4 py-3 font-medium">Origen</th>
                <th className="px-4 py-3 font-medium">Hora cierre</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <HistoryRow
                  key={`${t.ticket ?? t.id ?? t.order}-${t.close_time ?? t.time ?? Math.random()}`}
                  trade={t}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
