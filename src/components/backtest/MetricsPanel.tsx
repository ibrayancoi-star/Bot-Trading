"use client";

import { useBacktestStore } from "@/lib/store/backtest-store";
import { cn } from "@/lib/utils";

export function MetricsPanel() {
  const { metrics } = useBacktestStore();

  const kpis = [
    {
      label: "Win Rate",
      value: `${metrics.winRate.toFixed(1)}%`,
      colorClass: metrics.winRate >= 50 ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Profit Factor",
      value: metrics.profitFactor.toFixed(2),
      colorClass: metrics.profitFactor >= 1.5 ? "text-emerald-400" : metrics.profitFactor >= 1.0 ? "text-zinc-300" : "text-rose-400",
    },
    {
      label: "Max Drawdown",
      value: `${metrics.maxDrawdown.toFixed(2)}%`,
      colorClass: metrics.maxDrawdown <= 5.0 ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Sharpe Ratio",
      value: metrics.sharpeRatio.toFixed(2),
      colorClass: metrics.sharpeRatio >= 1.5 ? "text-emerald-400" : "text-zinc-300",
    },
    {
      label: "Total Trades",
      value: metrics.totalTrades,
      colorClass: "text-tv-text",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {kpis.map((kpi, idx) => (
        <div
          key={idx}
          className="bg-tv-panel border border-tv-border rounded-xl p-3 flex flex-col justify-between shadow-sm hover:border-zinc-700 transition-colors"
        >
          <span className="text-[10px] uppercase font-bold text-tv-text-muted">
            {kpi.label}
          </span>
          <span className={cn("text-lg font-bold font-mono mt-1", kpi.colorClass)}>
            {kpi.value}
          </span>
        </div>
      ))}
    </div>
  );
}
