import React, { memo, useState } from "react";
import { Position } from "@/lib/store/trading-store";
import { PnlCell } from "./PnlCell";
import { ModifySLTPModal } from "./ModifySLTPModal";
import { X, Edit2 } from "lucide-react";

interface PositionRowProps {
  pos: Position;
  onClose: (ticket: number) => void;
}

export const PositionRow = memo(({ pos, onClose }: PositionRowProps) => {
  const [isModifyOpen, setIsModifyOpen] = useState(false);
  const isBuy = pos.type === "buy";

  return (
    <>
      <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors group">
        <td className="px-4 py-2 font-mono text-xs text-zinc-400">#{pos.ticket}</td>
        <td className="px-4 py-2 text-zinc-100 font-medium">{pos.symbol}</td>
        <td className="px-4 py-2">
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
            isBuy ? "bg-emerald-500/10 text-emerald-400" : "bg-tv-red/10 text-tv-red"
          }`}>
            {pos.type.toUpperCase()}
          </span>
        </td>
        <td className="px-4 py-2 text-zinc-300">{pos.volume.toFixed(2)}</td>
        <td className="px-4 py-2 font-mono text-zinc-300">{pos.open_price.toFixed(5)}</td>
        <td className="px-4 py-2 font-mono text-zinc-100">{pos.current_price.toFixed(5)}</td>
        <td className="px-4 py-2 font-mono text-zinc-400">
          <div className="flex flex-col">
            <span className={pos.sl > 0 ? "text-tv-red" : ""}>SL: {pos.sl > 0 ? pos.sl.toFixed(5) : "—"}</span>
            <span className={pos.tp > 0 ? "text-emerald-400" : ""}>TP: {pos.tp > 0 ? pos.tp.toFixed(5) : "—"}</span>
          </div>
        </td>
        
        {/* Celda animada para PnL */}
        <PnlCell value={pos.profit} />

        <td className="px-4 py-2 text-right">
          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => setIsModifyOpen(true)}
              className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
              title="Modificar SL/TP"
            >
              <Edit2 size={14} />
            </button>
            <button 
              onClick={() => onClose(pos.ticket)}
              className="p-1.5 bg-tv-red/10 hover:bg-tv-red/20 text-tv-red rounded transition-colors"
              title="Cerrar Posición"
            >
              <X size={14} />
            </button>
          </div>
        </td>
      </tr>

      {isModifyOpen && (
        <ModifySLTPModal 
          pos={pos} 
          onClose={() => setIsModifyOpen(false)} 
        />
      )}
    </>
  );
}, (prev, next) => {
  // Solo re-renderizamos si cambia el precio, SL, TP, PnL o volumen.
  return (
    prev.pos.current_price === next.pos.current_price &&
    prev.pos.sl === next.pos.sl &&
    prev.pos.tp === next.pos.tp &&
    prev.pos.profit === next.pos.profit &&
    prev.pos.volume === next.pos.volume
  );
});
