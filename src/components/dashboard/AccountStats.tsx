"use client";

import { useTradingStore } from "@/lib/store/trading-store";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Shield, TrendingUp, AlertTriangle } from "lucide-react";

export function AccountStats() {
  const { account, risk, config } = useTradingStore();

  const dailyDrawdownPercent = ((config.maxDailyLoss - risk.remainingDailyLoss) / config.maxDailyLoss) * 100;
  const maxDrawdownPercent = ((config.maxOverallLoss - risk.remainingMaxLoss) / config.maxOverallLoss) * 100;

  return (
    <div className="flex items-center gap-6 px-4">
      {/* Balance & Equity */}
      <div className="flex items-center gap-4">
        <StatItem
          label="Balance"
          value={formatPrice(account.balance)}
          icon={<Shield className="h-3.5 w-3.5 text-tv-blue" />}
        />
        <StatItem
          label="Equity"
          value={formatPrice(account.equity)}
          icon={<TrendingUp className="h-3.5 w-3.5 text-tv-green" />}
          valueClass={account.equity >= account.balance ? "text-tv-green" : "text-tv-red"}
        />
      </div>

      <div className="h-6 w-[1px] bg-tv-border" />

      {/* Drawdown Metrics */}
      <div className="flex items-center gap-4">
        <RiskMetric
          label="Daily Loss"
          current={risk.remainingDailyLoss}
          max={config.maxDailyLoss}
          percent={dailyDrawdownPercent}
        />
        <RiskMetric
          label="Max Loss"
          current={risk.remainingMaxLoss}
          max={config.maxOverallLoss}
          percent={maxDrawdownPercent}
        />
      </div>

      {/* Status Badge */}
      <div className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        account.status === "active" ? "bg-tv-blue/10 text-tv-blue border border-tv-blue/20" :
        account.status === "passed" ? "bg-tv-green/10 text-tv-green border border-tv-green/20" :
        "bg-tv-red/10 text-tv-red border border-tv-red/20"
      )}>
        <span className={cn(
          "h-1.5 w-1.5 rounded-full",
          account.status === "active" ? "bg-tv-blue animate-pulse" :
          account.status === "passed" ? "bg-tv-green" : "bg-tv-red"
        )} />
        {account.status}
      </div>
    </div>
  );
}

function StatItem({ label, value, icon, valueClass }: { label: string; value: string; icon: React.ReactNode, valueClass?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-tight text-tv-text-dim flex items-center gap-1">
        {icon} {label}
      </span>
      <span className={cn("text-xs font-bold tabular-nums", valueClass ?? "text-tv-text")}>
        {value}
      </span>
    </div>
  );
}

function RiskMetric({ label, current, max, percent }: { label: string; current: number; max: number; percent: number }) {
  const isHighRisk = percent > 80;

  return (
    <div className="flex flex-col gap-1 w-24">
      <div className="flex justify-between text-[10px] uppercase tracking-tight">
        <span className="text-tv-text-dim">{label}</span>
        <span className={cn("font-medium", isHighRisk ? "text-tv-red" : "text-tv-text-muted")}>
          {Math.max(0, percent).toFixed(0)}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-tv-border">
        <div
          className={cn(
            "h-full transition-all duration-500",
            isHighRisk ? "bg-tv-red" : "bg-tv-blue"
          )}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}
