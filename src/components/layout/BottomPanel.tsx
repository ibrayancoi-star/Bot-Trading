"use client";

import { useState } from "react";
import { PositionsTable } from "@/components/dashboard/PositionsTable";
import { HistoryPanel } from "@/components/dashboard/HistoryPanel";
import { useTradingStore } from "@/lib/store/trading-store";
import { cn } from "@/lib/utils";

type TabId = "positions" | "history";

export function BottomPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("positions");
  const { positions, historicalTrades } = useTradingStore();

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "positions", label: "Posiciones", count: positions.length },
    { id: "history", label: "Historial", count: historicalTrades.length },
  ];

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-tv-border bg-tv-panel">
      <div className="flex h-9 items-center justify-between border-b border-tv-border bg-tv-bg/50">
        {/* Tabs */}
        <div className="flex h-full items-stretch">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`bottom-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex items-center gap-1.5 px-4 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                activeTab === tab.id
                  ? "text-tv-text after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-tv-blue after:rounded-t"
                  : "text-tv-text-dim hover:text-tv-text-muted"
              )}
            >
              {tab.label}
              {typeof tab.count === "number" && tab.count > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[16px] text-[9px] font-bold tabular-nums",
                    activeTab === tab.id
                      ? "bg-tv-blue/20 text-tv-blue"
                      : "bg-tv-border/60 text-tv-text-dim"
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Right side indicator */}
        <div className="flex items-center gap-2 px-3 text-[10px] text-tv-text-dim">
          <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-tv-green" />
          <span>Live · MT5</span>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "positions" && <PositionsTable />}
        {activeTab === "history" && <HistoryPanel />}
      </div>
    </div>
  );
}
