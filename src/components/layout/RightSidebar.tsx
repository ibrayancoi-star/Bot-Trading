"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { useChartStore } from "@/lib/store/chart-store";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { AccountStats } from "@/components/dashboard/AccountStats";
import { sendTradeOrder } from "@/lib/data/mock-feed";
import { cn } from "@/lib/utils";

export function RightSidebar() {
  const { accountType, setAccountType, positions, isBotActive, toggleBot, connection, account } = useTradingStore();
  const symbol = useChartStore((s) => s.symbol);

  const [lotSize, setLotSize] = useState<number>(0.1);
  const [tp, setTp] = useState<number>(0);
  const [sl, setSl] = useState<number>(0);

  const handleTrade = (type: "buy" | "sell") => {
    sendTradeOrder(symbol, type, lotSize, tp, sl);
  };

  const handleCloseLastPosition = () => {
    const last = positions[positions.length - 1];
    if (!last || !last.ticket) return;

    const action = last.type === "BUY" ? "sell" : "buy";
    sendTradeOrder(last.symbol, action, last.lotSize, 0, 0); // Cerrar posicion abriendo orden opuesta o usar endpoint especifico
  };

  return (
    <aside className="flex w-64 flex-col border-l border-tv-border bg-tv-panel overflow-y-auto overflow-x-hidden">
      
      {/* Account Switcher */}
      <div className="p-4 flex items-center justify-between bg-tv-bg/80">
        <div className="flex gap-1 bg-tv-bg p-1 rounded-md w-full">
          <button
            onClick={() => setAccountType("real")}
            className={cn(
              "flex-1 text-[10px] font-semibold py-1.5 rounded-sm transition-all",
              accountType === "real" ? "bg-tv-blue text-white shadow" : "text-tv-text-muted hover:text-tv-text"
            )}
          >
            REAL
          </button>
          <button
            onClick={() => setAccountType("fondeo")}
            className={cn(
              "flex-1 text-[10px] font-semibold py-1.5 rounded-sm transition-all",
              accountType === "fondeo" ? "bg-tv-blue text-white shadow" : "text-tv-text-muted hover:text-tv-text"
            )}
          >
            FONDEO
          </button>
          <button
            onClick={() => setAccountType("demo")}
            className={cn(
              "flex-1 text-[10px] font-semibold py-1.5 rounded-sm transition-all",
              accountType === "demo" ? "bg-tv-blue text-white shadow" : "text-tv-text-muted hover:text-tv-text"
            )}
          >
            DEMO
          </button>
        </div>
      </div>

      {/* Connection Info */}
      <div className="px-4 pb-2 text-[10px] text-tv-text-muted flex justify-between items-center">
        <span>{account.server || "Broker Server"}</span>
        <span className="font-mono">{account.login || "---"}</span>
      </div>

      {/* Account Stats Panel */}
      <div className="flex flex-col items-start w-full py-2 space-y-4">
        <AccountStats />
      </div>

      <Separator className="bg-tv-border" />

      {/* Bot Panel */}
      <div className="p-4 bg-tv-bg/50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Auto Trading
          </h3>
          <div className={cn("h-2.5 w-2.5 rounded-full", isBotActive ? "bg-tv-green animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-tv-red")} />
        </div>
        <Button
          onClick={toggleBot}
          className={cn(
            "w-full h-10 text-xs font-bold transition-all",
            isBotActive
              ? "bg-tv-red/10 text-tv-red border border-tv-red/20 hover:bg-tv-red hover:text-white"
              : "bg-tv-blue/10 text-tv-blue border border-tv-blue/20 hover:bg-tv-blue hover:text-white"
          )}
        >
          {isBotActive ? "DETENER BOT" : "INICIAR BOT"}
        </Button>
      </div>

      <Separator className="bg-tv-border" />

      {/* Trade Panel */}
      <div className="p-4 bg-tv-bg/30 flex-1">
        <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Ejecución de Mercado
        </h3>
        
        {/* Configuración de Orden */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex justify-between items-center bg-tv-bg border border-tv-border rounded-md px-3 py-2">
            <span className="text-xs text-tv-text-muted">Lotaje</span>
            <input 
              type="number" 
              step="0.01" 
              min="0.01"
              value={lotSize} 
              onChange={(e) => setLotSize(parseFloat(e.target.value) || 0)}
              className="bg-transparent text-right text-sm font-mono text-tv-text outline-none w-16"
            />
          </div>
          <div className="flex justify-between items-center bg-tv-bg border border-tv-border rounded-md px-3 py-2">
            <span className="text-xs text-tv-text-muted">TP Price</span>
            <input 
              type="number" 
              step="0.0001" 
              value={tp} 
              onChange={(e) => setTp(parseFloat(e.target.value) || 0)}
              className="bg-transparent text-right text-sm font-mono text-tv-text outline-none w-24"
            />
          </div>
          <div className="flex justify-between items-center bg-tv-bg border border-tv-border rounded-md px-3 py-2">
            <span className="text-xs text-tv-text-muted">SL Price</span>
            <input 
              type="number" 
              step="0.0001" 
              value={sl} 
              onChange={(e) => setSl(parseFloat(e.target.value) || 0)}
              className="bg-transparent text-right text-sm font-mono text-tv-text outline-none w-24"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            onClick={() => handleTrade("buy")}
            disabled={connection.status !== "connected"}
            className="h-14 w-full bg-emerald-600 text-white hover:bg-emerald-500 transition-all flex flex-col gap-0 border-0 shadow-md"
          >
            <TrendingUp className="h-4 w-4 mb-0.5" />
            <span className="text-xs font-bold">BUY {symbol}</span>
          </Button>
          <Button
            onClick={() => handleTrade("sell")}
            disabled={connection.status !== "connected"}
            className="h-14 w-full bg-rose-600 text-white hover:bg-rose-500 transition-all flex flex-col gap-0 border-0 shadow-md"
          >
            <TrendingDown className="h-4 w-4 mb-0.5" />
            <span className="text-xs font-bold">SELL {symbol}</span>
          </Button>
        </div>

        {positions.length > 0 && (
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-10 text-xs border-tv-border hover:bg-tv-red/10 hover:text-tv-red hover:border-tv-red/30 transition-all gap-2"
              onClick={handleCloseLastPosition}
            >
              <Trash2 className="h-4 w-4" />
              Cerrar Última
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
