"use client";

import { Header } from "@/components/layout/Header";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { BottomPanel } from "@/components/layout/BottomPanel";
import { PriceChart } from "@/components/chart/PriceChart";
import { IndicatorSettingsDialog } from "@/components/chart/IndicatorSettingsDialog";
import { useChartStore } from "@/lib/store/chart-store";
import { useModeStore } from "@/lib/store/mode-store";

// Backtest imports
import { BacktestPanel } from "@/components/backtest/BacktestPanel";
import { BacktestChart } from "@/components/backtest/BacktestChart";
import { EquityCurveChart } from "@/components/backtest/EquityCurveChart";
import { MetricsPanel } from "@/components/backtest/MetricsPanel";
import { TradeLog } from "@/components/backtest/TradeLog";
import { BacktestExport } from "@/components/backtest/BacktestExport";

export default function HomePage() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const mode = useModeStore((s) => s.mode);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-tv-bg text-tv-text select-none">
      <Header />
      <div className="flex min-h-0 flex-1">
        {mode === "BACKTEST" && <BacktestPanel />}
        <main className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 flex flex-col">
            {mode === "BACKTEST" ? (
              <div className="flex-1 flex flex-col min-h-0">
                <BacktestChart symbol={symbol} />
                <div className="p-4 bg-zinc-950 flex flex-col gap-4 border-t border-tv-border overflow-y-auto max-h-[40%]">
                  <div className="flex justify-between items-center gap-4">
                    <MetricsPanel />
                    <BacktestExport />
                  </div>
                  <div className="flex gap-4 min-h-0 flex-1">
                    <div className="flex-1 min-h-0">
                      <TradeLog />
                    </div>
                    <div className="w-[300px] shrink-0">
                      <EquityCurveChart />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <PriceChart symbol={symbol} timeframe={timeframe} />
            )}
          </div>
        </main>
        {mode !== "BACKTEST" && <RightSidebar />}
      </div>
      {mode !== "BACKTEST" && <BottomPanel />}
      <IndicatorSettingsDialog />
      <LeftSidebar />
    </div>
  );
}
