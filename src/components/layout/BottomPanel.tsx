"use client";

import { PositionsTable } from "@/components/dashboard/PositionsTable";

export function BottomPanel() {
  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-tv-border bg-tv-panel">
      <div className="flex h-9 items-center justify-between px-3 border-b border-tv-border bg-tv-bg/50">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Positions
        </h2>
        <div className="flex items-center gap-2 text-[10px] text-tv-text-dim">
          <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-tv-green" />
          <span>Mock · cTrader</span>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <PositionsTable />
      </div>
    </div>
  );
}


