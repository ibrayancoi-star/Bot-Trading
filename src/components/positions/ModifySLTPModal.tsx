import React, { useState } from "react";
import { Position } from "@/lib/store/trading-store";
import { modifyPosition } from "@/lib/data/mock-feed";
import { X } from "lucide-react";

interface ModifyProps {
  pos: Position;
  onClose: () => void;
}

export function ModifySLTPModal({ pos, onClose }: ModifyProps) {
  const [sl, setSl] = useState(pos.sl ? pos.sl.toString() : "");
  const [tp, setTp] = useState(pos.tp ? pos.tp.toString() : "");

  const handleSave = () => {
    const numSl = parseFloat(sl) || 0;
    const numTp = parseFloat(tp) || 0;
    modifyPosition(pos.ticket, numTp, numSl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl w-80 overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-zinc-800 bg-zinc-950">
          <h3 className="text-sm font-semibold text-zinc-100">Modificar #{pos.ticket}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Stop Loss (Price)</label>
            <input 
              type="number" 
              step="0.00001"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-tv-blue"
              placeholder="0.00000"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Take Profit (Price)</label>
            <input 
              type="number" 
              step="0.00001"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-tv-blue"
              placeholder="0.00000"
            />
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} className="px-3 py-1.5 text-sm bg-tv-blue text-white rounded hover:bg-tv-blue/90 transition-colors">
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
