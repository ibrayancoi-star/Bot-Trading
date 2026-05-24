"use client";

import { useState, useEffect } from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { useChartStore } from "@/lib/store/chart-store";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, TrendingDown, Trash2, AlertTriangle } from "lucide-react";
import { AccountStats } from "@/components/dashboard/AccountStats";
import { sendTradeOrder, closePositionOnBridge } from "@/lib/data/mock-feed";
import { cn } from "@/lib/utils";

export function RightSidebar() {
  const { accountType, setAccountType, positions, isBotActive, toggleBot, connection, account, algoTradingEnabled, knownAccounts } = useTradingStore();
  const symbol = useChartStore((s) => s.symbol);

  const [lotSize, setLotSize] = useState<number>(0.1);
  const [tp, setTp] = useState<number>(0);
  const [sl, setSl] = useState<number>(0);

  const isConnected = connection.status === "connected";
  const canTrade = isConnected && algoTradingEnabled;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleTrade = (type: "buy" | "sell") => {
    if (!canTrade) return;
    sendTradeOrder(symbol, type, lotSize, tp, sl);
  };

  const handleCloseLastPosition = () => {
    const last = positions[positions.length - 1];
    const ticket = last?.ticket || (last ? parseInt(last.id) : null);
    if (ticket) {
      closePositionOnBridge(ticket);
    }
  };

  return (
    <aside className="flex w-64 flex-col border-l border-tv-border bg-tv-panel overflow-y-auto overflow-x-hidden">
      
      {/* Connection Info (Cuenta Activa) */}
      <div className="p-4 pb-2 text-[10px] text-tv-text-muted flex flex-col gap-1 bg-tv-bg/80">
        <div className="flex justify-between items-center">
          <span>{account.server || "Broker Server"}</span>
          <span className="font-mono text-emerald-400">{account.login ? `Activa: ${account.login}` : "---"}</span>
        </div>
      </div>

      {/* Known Accounts List */}
      {mounted && Object.values(knownAccounts).length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-[10px] font-semibold text-tv-text-muted uppercase mb-1.5">
            Cuentas Registradas
          </div>
          <div className="flex flex-col gap-1">
            {Object.values(knownAccounts)
              .sort((a, b) => {
                const aIsCurrent = a.login === account.login && a.server === account.server;
                const bIsCurrent = b.login === account.login && b.server === account.server;
                if (aIsCurrent && !bIsCurrent) return -1;
                if (!aIsCurrent && bIsCurrent) return 1;
                return b.lastSeen - a.lastSeen;
              })
              .map((ka) => {
                const isCurrent = ka.login === account.login && ka.server === account.server;
                return (
                  <div 
                    key={`${ka.server}_${ka.login}`} 
                    className={cn(
                      "flex items-center justify-between text-[10px] rounded px-2 py-1",
                      isCurrent ? "bg-tv-blue/20 border border-tv-blue/30 text-tv-text" : "bg-tv-bg/50 text-tv-text-muted"
                    )}
                  >
                    <div className="flex flex-col">
                      <span className="font-mono">{ka.login}</span>
                      <span className="text-[8px] opacity-70 truncate max-w-[100px]">{ka.server}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={ka.type}
                        onChange={(e) => {
                          const newType = e.target.value as "real" | "fondeo" | "demo";
                          useTradingStore.getState().registerKnownAccount(ka.login, ka.server, newType);
                          if (isCurrent) {
                            useTradingStore.getState().setAccountType(newType);
                          }
                        }}
                        className={cn(
                          "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm appearance-none cursor-pointer outline-none text-center",
                          ka.type === "real" ? "bg-blue-900/40 text-blue-400" :
                          ka.type === "fondeo" ? "bg-purple-900/40 text-purple-400" :
                          "bg-gray-800 text-gray-400"
                        )}
                      >
                        <option value="real" className="bg-tv-panel text-blue-400">REAL</option>
                        <option value="fondeo" className="bg-tv-panel text-purple-400">FONDEO</option>
                        <option value="demo" className="bg-tv-panel text-gray-400">DEMO</option>
                      </select>
                      {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Algo Trading Warning */}
      {isConnected && !algoTradingEnabled && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-amber-700/50 bg-amber-950/50 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="text-[10px] leading-tight text-amber-200">
            <strong>Algo Trading deshabilitado</strong> en MT5. Actívalo para operar desde la web.
          </span>
        </div>
      )}

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
            disabled={!canTrade}
            className={cn(
              "h-14 w-full bg-emerald-600 text-white hover:bg-emerald-500 transition-all flex flex-col gap-0 border-0 shadow-md",
              !canTrade && "opacity-50 cursor-not-allowed"
            )}
          >
            <TrendingUp className="h-4 w-4 mb-0.5" />
            <span className="text-xs font-bold">BUY {symbol}</span>
          </Button>
          <Button
            onClick={() => handleTrade("sell")}
            disabled={!canTrade}
            className={cn(
              "h-14 w-full bg-rose-600 text-white hover:bg-rose-500 transition-all flex flex-col gap-0 border-0 shadow-md",
              !canTrade && "opacity-50 cursor-not-allowed"
            )}
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
              disabled={!canTrade}
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
