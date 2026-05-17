"use client";

import { Code2, Zap, Link } from "lucide-react";
import { SymbolSelector } from "@/components/chart/SymbolSelector";
import { TimeframeSelector } from "@/components/chart/TimeframeSelector";
import { IndicatorMenu } from "@/components/chart/IndicatorMenu";
import { Separator } from "@/components/ui/separator";
import { useTradingStore } from "@/lib/store/trading-store";

export function Header() {
  const connection = useTradingStore((s) => s.connection);

  return (
    <header className="flex h-12 items-center justify-between border-b border-tv-border bg-tv-panel px-3">
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-2 pr-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-tv-blue/20">
            <Zap className="h-4 w-4 text-tv-blue" />
          </div>
          <span className="text-sm font-semibold text-tv-text">
            TradingView <span className="text-tv-text-muted">Gratis</span>
          </span>
        </div>
        <Separator orientation="vertical" className="h-6 bg-tv-border" />
        <SymbolSelector />
        <Separator orientation="vertical" className="h-6 bg-tv-border" />
        <TimeframeSelector />
        <Separator orientation="vertical" className="mx-1 h-6 bg-tv-border" />
        <IndicatorMenu />
      </div>

      <div className="flex items-center gap-4">
        {/* Indicador de Conexión del Puente MT5 */}
        <div className="flex items-center gap-2.5 rounded-md border border-tv-border bg-tv-panel-hover px-3 py-1.5 text-xs font-medium text-tv-text shadow-sm">
          {connection.status === "connected" && (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tv-green opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-tv-green"></span>
              </span>
              <span className="text-tv-text-muted">
                MT5: <span className="text-tv-green font-semibold">Activo</span>
                {connection.metadata && (
                  <span className="hidden md:inline">
                    {" "}(#{connection.metadata.login} · {connection.metadata.server})
                  </span>
                )}
              </span>
            </>
          )}

          {connection.status === "connecting" && (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-500 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-500"></span>
              </span>
              <span className="text-tv-text-muted animate-pulse">
                MT5: <span className="text-yellow-500 font-semibold">Conectando...</span>
              </span>
            </>
          )}

          {connection.status === "disconnected" && (
            <>
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex h-2 w-2 rounded-full bg-tv-red"></span>
              </span>
              <span className="text-tv-text-muted">
                MT5: <span className="text-tv-red font-semibold">Inactivo</span> 
                <span className="hidden lg:inline"> (Ejecuta `mt5_bridge.py`)</span>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Source</span>
          </a>
        </div>
      </div>
    </header>
  );
}
