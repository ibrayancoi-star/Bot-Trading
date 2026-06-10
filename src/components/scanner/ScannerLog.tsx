import React from "react";
import { useTradingStore } from "@/lib/store/trading-store";
import { Zap, XCircle, CheckCircle, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

export const ScannerLog = React.memo(function ScannerLog() {
  const scannerSignals = useTradingStore((s) => s.scannerSignals);

  return (
    <div className="flex flex-col h-full max-h-[300px] bg-tv-bg/50 border-b border-tv-border">
      <div className="p-3 pb-2 flex items-center justify-between border-b border-tv-border bg-tv-panel/50">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-tv-text-muted flex items-center gap-1.5">
          📡 Señales del Scanner
        </h3>
        <span className="text-[9px] text-tv-text-muted font-mono">{scannerSignals.length}</span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {scannerSignals.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[10px] text-tv-text-muted/50 italic">
            Esperando señales del mercado...
          </div>
        ) : (
          scannerSignals.slice(0, 20).map((signal) => {
            const isDetected = signal.action === "DETECTED";
            const isDismissed = signal.action === "DISMISSED";
            const isExecuted = signal.action === "EXECUTED";
            const isFailed = signal.action === "FAILED";

            return (
              <div 
                key={signal.id} 
                className="flex flex-col gap-1 p-2 rounded-md bg-tv-panel border border-tv-border/50 text-[10px]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-medium">
                    {isDetected && <Zap className="h-3 w-3 text-tv-amber" />}
                    {isDismissed && <XCircle className="h-3 w-3 text-tv-text-muted" />}
                    {isExecuted && <CheckCircle className="h-3 w-3 text-tv-green" />}
                    {isFailed && <AlertOctagon className="h-3 w-3 text-tv-red" />}
                    
                    <span className={cn(
                      isDetected && "text-tv-amber",
                      isDismissed && "text-tv-text-muted",
                      isExecuted && "text-tv-green",
                      isFailed && "text-tv-red"
                    )}>
                      {signal.symbol} {signal.direction}
                    </span>
                    {signal.price && <span className="text-tv-text-muted font-mono ml-1">@{signal.price}</span>}
                  </div>
                  <div className="text-[9px] text-tv-text-muted/60 font-mono">
                    {new Date(signal.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                
                {signal.reason && (
                  <div className="text-[9px] text-tv-text-muted/80 pl-4 border-l border-tv-border/50 ml-1.5">
                    {signal.reason}
                  </div>
                )}
                {!signal.reason && signal.message && (
                  <div className="text-[9px] text-tv-text-muted/80 pl-4 border-l border-tv-border/50 ml-1.5 truncate">
                    {signal.message}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
