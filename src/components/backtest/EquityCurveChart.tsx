"use client";

import { useBacktestStore } from "@/lib/store/backtest-store";

export function EquityCurveChart() {
  const { equityCurve } = useBacktestStore();

  if (equityCurve.length < 2) {
    return (
      <div className="flex h-32 w-full items-center justify-center bg-zinc-950/40 border border-tv-border rounded text-[10px] text-tv-text-dim">
        Esperando datos de balance para graficar la curva...
      </div>
    );
  }

  // Find min and max for scaling
  const equities = equityCurve.map((e) => e.equity);
  const minEquity = Math.min(...equities) * 0.999;
  const maxEquity = Math.max(...equities) * 1.001;
  const range = maxEquity - minEquity || 1;

  // Build SVG Path
  const width = 500;
  const height = 120;
  const padding = 10;
  const usableHeight = height - padding * 2;
  const usableWidth = width;

  const points = equityCurve.map((point, index) => {
    const x = (index / (equityCurve.length - 1)) * usableWidth;
    const y = height - padding - ((point.equity - minEquity) / range) * usableHeight;
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(" L ")}`;

  // Area path for gradient fill
  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;

  return (
    <div className="bg-tv-panel border border-tv-border rounded-xl p-3 flex flex-col gap-2 shadow-sm">
      <div className="flex justify-between items-center text-[10px] uppercase font-bold text-tv-text-muted">
        <span>Curva de Equity</span>
        <span className="font-mono text-emerald-400 text-xs">
          Balance: ${equityCurve[equityCurve.length - 1].equity.toFixed(2)}
        </span>
      </div>

      <div className="relative w-full h-32 overflow-hidden bg-zinc-950/40 rounded-lg">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#2a2e39" strokeWidth="0.5" strokeDasharray="3 3" />
          <line x1="0" y1={padding} x2={width} y2={padding} stroke="#2a2e39" strokeWidth="0.5" strokeDasharray="3 3" />
          <line x1="0" y1={height - padding} x2={width} y2={height - padding} stroke="#2a2e39" strokeWidth="0.5" strokeDasharray="3 3" />

          {/* Gradient Area under curve */}
          <path d={areaD} fill="url(#equityGrad)" />

          {/* Smooth line */}
          <path
            d={pathD}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Dynamic labels */}
        <div className="absolute top-1 left-2 text-[8px] font-mono text-tv-text-dim">
          Máx: ${maxEquity.toFixed(0)}
        </div>
        <div className="absolute bottom-1 left-2 text-[8px] font-mono text-tv-text-dim">
          Mín: ${minEquity.toFixed(0)}
        </div>
      </div>
    </div>
  );
}
