"use client";

import { useBacktestStore } from "@/lib/store/backtest-store";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export function BacktestExport() {
  const { trades, metrics, status } = useBacktestStore();

  const handleExport = () => {
    if (trades.length === 0) return;

    // Generate markdown string
    const nowStr = new Date().toLocaleString();
    const mdLines = [
      `# Backtest Report — EURUSD/GBPUSD Simulation`,
      `Fecha ejecución: ${nowStr}`,
      `Métricas Globales:`,
      `- Win Rate: ${metrics.winRate}%`,
      `- Profit Factor: ${metrics.profitFactor}`,
      `- Max Drawdown: ${metrics.maxDrawdown}%`,
      `- Sharpe Ratio: ${metrics.sharpeRatio}`,
      `- Total Operaciones: ${metrics.totalTrades}`,
      `- Operaciones sin validación ChromaDB: ${metrics.unvalidatedTradesCount}`,
      ``,
      `## Operaciones`,
      `| # | Tipo | Entrada | Salida | P&L | ChromaDB | Detalle |`,
      `|---|------|---------|--------|-----|----------|---------|`
    ];

    trades.forEach((t, idx) => {
      const dbVal = t.chromadb_validated ? "✅ Validado" : "⚠️ Falló/Sin DB";
      mdLines.push(
        `| ${idx + 1} | ${t.type.toUpperCase()} | ${t.open_price.toFixed(5)} | ${
          t.close_price?.toFixed(5) || "Abierta"
        } | ${t.pnl !== undefined ? `$${t.pnl.toFixed(2)}` : "—"} | ${dbVal} | ${
          t.reason || "Sin confluencias negativas encontradas"
        } |`
      );
    });

    const mdString = mdLines.join("\n");
    const blob = new Blob([mdString], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `backtest_report_${Date.now()}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const hasData = trades.length > 0;

  return (
    <Button
      onClick={handleExport}
      disabled={!hasData || status === "running"}
      className="h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-all px-4 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download className="h-4 w-4" />
      <span>EXPORTAR REPORTE MD</span>
    </Button>
  );
}
