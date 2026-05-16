"use client";

import { useTradingStore } from "@/lib/store/trading-store";
import { useChartStore } from "@/lib/store/chart-store";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { AccountStats } from "@/components/dashboard/AccountStats";

export function RightSidebar() {
  const { addPosition, positions, closePosition, isBotActive, toggleBot } = useTradingStore();
  const symbol = useChartStore((s) => s.symbol);

  const handleTrade = async (type: "BUY" | "SELL") => {
    // Para simplificar, asumimos un precio base, en un entorno real vendría del feed
    const mockPrice = 1.08 + (Math.random() - 0.5) * 0.01;
    
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer ttp-secret-token" // Simulación de Auth
        },
        body: JSON.stringify({
          action: "OPEN",
          symbol,
          type,
          lotSize: 1.0,
          price: mockPrice
        })
      });

      const data = await res.json();
      
      if (data.success) {
        addPosition({
          id: data.data.orderId,
          symbol: data.data.symbol,
          type: data.data.type,
          lotSize: data.data.lotSize,
          entryPrice: data.data.executionPrice,
          currentPrice: data.data.executionPrice,
          pnl: 0,
        });
      } else {
        console.error("Error del broker:", data.error);
      }
    } catch (err) {
      console.error("Error de conexión con el API:", err);
    }
  };

  const handleCloseLastPosition = async () => {
    const last = positions[positions.length - 1];
    if (!last) return;

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer ttp-secret-token"
        },
        body: JSON.stringify({
          action: "CLOSE",
          orderId: last.id,
          symbol: last.symbol,
          type: last.type,
          lotSize: last.lotSize,
          price: last.entryPrice + 0.0001 // Mock exit price
        })
      });

      const data = await res.json();

      if (data.success) {
        closePosition(last.id, {
          id: last.id,
          symbol: last.symbol,
          type: last.type,
          entryPrice: last.entryPrice,
          exitPrice: data.data.closePrice,
          lotSize: last.lotSize,
          pnl: 10, // Mock PnL para el cierre manual
          pnlPercentage: 0.1,
          duration: 60,
          closedAt: data.data.timestamp,
        });
      }
    } catch (err) {
      console.error("Error cerrando posición en API:", err);
    }
  };

  return (
    <aside className="flex w-64 flex-col border-l border-tv-border bg-tv-panel overflow-y-auto overflow-x-hidden">
      {/* Account Stats Panel */}
      <div className="flex flex-col items-start w-full py-4 space-y-4">
        <AccountStats />
      </div>

      <Separator className="bg-tv-border" />

      {/* Bot Panel */}
      <div className="p-4 bg-tv-bg/50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Auto Trading
          </h3>
          <div className={`h-2.5 w-2.5 rounded-full ${isBotActive ? "bg-tv-green animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-tv-red"}`} />
        </div>
        <Button
          onClick={toggleBot}
          className={`w-full h-10 text-xs font-bold transition-all ${
            isBotActive
              ? "bg-tv-red/10 text-tv-red border border-tv-red/20 hover:bg-tv-red hover:text-white"
              : "bg-tv-blue/10 text-tv-blue border border-tv-blue/20 hover:bg-tv-blue hover:text-white"
          }`}
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
        
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => handleTrade("BUY")}
            className="h-16 w-full bg-emerald-600 text-white hover:bg-emerald-500 transition-all flex flex-col gap-1 border-0 shadow-md"
          >
            <TrendingUp className="h-5 w-5" />
            <span className="text-xs font-bold">BUY {symbol} 1.00 Lot</span>
          </Button>
          <Button
            onClick={() => handleTrade("SELL")}
            className="h-16 w-full bg-rose-600 text-white hover:bg-rose-500 transition-all flex flex-col gap-1 border-0 shadow-md"
          >
            <TrendingDown className="h-5 w-5" />
            <span className="text-xs font-bold">SELL {symbol} 1.00 Lot</span>
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
              Cerrar Última Posición
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
