"use client";

import { useBacktestStore } from "@/lib/store/backtest-store";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";

export function TradeLog() {
  const { trades } = useBacktestStore();

  return (
    <div className="bg-tv-panel border border-tv-border rounded-xl flex-1 flex flex-col overflow-hidden min-h-[200px] shadow-sm">
      <div className="p-3 border-b border-tv-border bg-tv-bg/50 flex justify-between items-center">
        <h3 className="font-bold text-[10px] uppercase text-tv-text-muted">
          Registro de Operaciones
        </h3>
        <span className="text-[10px] text-tv-text-dim font-mono">
          {trades.length} posiciones ejecutadas
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {trades.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-tv-text-dim py-8">
            Ninguna posición ejecutada en esta simulación.
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-tv-border bg-tv-bg/30 text-[10px] text-tv-text-muted uppercase font-bold sticky top-0 z-10">
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Entrada</th>
                <th className="px-3 py-2">Salida</th>
                <th className="px-3 py-2 text-right">P&L</th>
                <th className="px-3 py-2 text-center">ChromaDB</th>
                <th className="px-3 py-2">Detalle / Exclusión</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const isWin = (t.pnl || 0) > 0;
                return (
                  <tr
                    key={t.ticket}
                    className="border-b border-tv-border hover:bg-tv-panel-hover transition-colors font-mono"
                  >
                    <td className="px-3 py-2 text-tv-text-dim">#{t.ticket}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${
                          t.type === "buy"
                            ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/50"
                            : "bg-rose-950/40 text-rose-400 border border-rose-900/50"
                        }`}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-tv-text">{t.open_price.toFixed(5)}</td>
                    <td className="px-3 py-2 text-tv-text-dim">
                      {t.close_price ? t.close_price.toFixed(5) : "Abierta"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-bold ${
                        isWin ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {t.pnl !== undefined ? `$${t.pnl.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center">
                        {t.chromadb_validated ? (
                          <span title="Validado con ChromaDB">
                            <CheckCircle className="h-4 w-4 text-emerald-400" />
                          </span>
                        ) : (
                          <span title="Advertencia: Operó sin validación ChromaDB">
                            <AlertTriangle className="h-4 w-4 text-amber-500 animate-pulse" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-tv-text-dim max-w-xs truncate text-[10px]" title={t.reason}>
                      {t.reason || "Bajo validación de filtros Capa 1 y Capa 2."}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
