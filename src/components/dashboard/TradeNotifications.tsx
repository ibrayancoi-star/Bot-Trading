"use client";

import { useEffect } from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { cn } from "@/lib/utils";
import { X, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export function TradeNotifications() {
  const notifications = useTradingStore((s) => s.notifications);
  const dismissNotification = useTradingStore((s) => s.dismissNotification);

  // Auto-dismiss after 6 seconds
  useEffect(() => {
    if (notifications.length === 0) return;
    const timers = notifications.map((n) =>
      setTimeout(() => dismissNotification(n.id), 6000)
    );
    return () => timers.forEach(clearTimeout);
  }, [notifications, dismissNotification]);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm",
            "animate-in slide-in-from-right-5 fade-in duration-300",
            n.type === "success" && "bg-emerald-950/90 border-emerald-700/50 text-emerald-100",
            n.type === "error" && "bg-rose-950/90 border-rose-700/50 text-rose-100",
            n.type === "warning" && "bg-amber-950/90 border-amber-700/50 text-amber-100",
          )}
        >
          <div className="mt-0.5 shrink-0">
            {n.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            {n.type === "error" && <XCircle className="h-4 w-4 text-rose-400" />}
            {n.type === "warning" && <AlertTriangle className="h-4 w-4 text-amber-400" />}
          </div>
          <p className="flex-1 text-xs font-medium leading-relaxed">{n.message}</p>
          <button
            onClick={() => dismissNotification(n.id)}
            className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
