import React, { memo, useRef, useEffect } from "react";

interface PnlCellProps {
  value: number;
}

export const PnlCell = memo(({ value }: PnlCellProps) => {
  const isPositive = value >= 0;
  const colorClass = isPositive ? "text-emerald-400" : "text-tv-red";
  const formatted = (isPositive ? "+" : "") + value.toFixed(2);
  
  const prevValue = useRef(value);
  const cellRef = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (!cellRef.current) return;
    if (value > prevValue.current) {
      cellRef.current.classList.add("bg-emerald-500/20");
      setTimeout(() => cellRef.current?.classList.remove("bg-emerald-500/20"), 300);
    } else if (value < prevValue.current) {
      cellRef.current.classList.add("bg-tv-red/20");
      setTimeout(() => cellRef.current?.classList.remove("bg-tv-red/20"), 300);
    }
    prevValue.current = value;
  }, [value]);

  return (
    <td 
      ref={cellRef}
      className={`px-4 py-2 text-right font-mono text-sm transition-colors duration-300 ${colorClass}`}
    >
      ${formatted}
    </td>
  );
}, (prev, next) => prev.value === next.value);
