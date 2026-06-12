# verify_range_logic.py — Verificación de lógica de rangos ANTES de implementar
# Ejecutar: python verify_range_logic.py (con MT5 abierto)
# Solo lectura. No toca el bridge ni el bot.

import MetaTrader5 as mt5
from datetime import datetime

TOLERANCE_PIPS = {"EURUSD": 2.5, "GBPUSD": 3.0}
PIP = 0.0001
SYMBOLS = ["EURUSD", "GBPUSD"]

def to_dicts(rates):
    return [{
        "time": int(r["time"]),
        "open": float(r["open"]),
        "high": float(r["high"]),
        "low": float(r["low"]),
        "close": float(r["close"])
    } for r in rates]

def fecha(ts, fmt="%d/%m %H:%M"):
    return datetime.fromtimestamp(ts).strftime(fmt)

def is_broken(cand, later, tol):
    """Evalúa si el rango de 'cand' fue roto por velas cerradas posteriores."""
    high, low = cand["high"], cand["low"]
    for j, c in enumerate(later):
        bt = max(c["open"], c["close"])
        bb = min(c["open"], c["close"])

        # Ruptura dura: cuerpo excede más allá de la tolerancia
        if bt > high + tol:
            return True, f"HIGH roto >tol por {fecha(c['time'])} (body={bt:.5f})"
        if bb < low - tol:
            return True, f"LOW roto >tol por {fecha(c['time'])} (body={bb:.5f})"

        # Exceso suave por arriba: dentro de tolerancia, requiere retorno
        if high < bt <= high + tol:
            returned = any(low <= cc["close"] <= high for cc in later[j+1:])
            if not returned:
                return True, f"HIGH excedido ≤tol por {fecha(c['time'])} SIN retorno"
        # Exceso suave por abajo
        if low > bb >= low - tol:
            returned = any(low <= cc["close"] <= high for cc in later[j+1:])
            if not returned:
                return True, f"LOW excedido ≤tol por {fecha(c['time'])} SIN retorno"
    return False, ""

def find_reference(closed, tol):
    """Última vela cerrada cuyo rango no fue roto. Retorna (vela, log)."""
    logs = []
    for i in range(len(closed) - 1, -1, -1):
        broken, reason = is_broken(closed[i], closed[i+1:], tol)
        status = f"❌ {reason}" if broken else "✅ VÁLIDA"
        logs.append(f"  {fecha(closed[i]['time'])} | H={closed[i]['high']:.5f} L={closed[i]['low']:.5f} | {status}")
        if not broken:
            return closed[i], logs
    return closed[-1], logs + ["  ⚠️ FALLBACK: última cerrada"]

def compute_bias(range_high, range_low, candles_after, current_bid):
    """
    Bias según el último extremo tomado (por precio, incluyendo mechas).
    Max tomado → SELL (hacia el min). Min tomado → BUY (hacia el max).
    """
    bias = None
    last_event = ""
    for c in candles_after:
        if c["high"] >= range_high:
            bias = "SELL"
            last_event = f"max tomado en {fecha(c['time'])}"
        if c["low"] <= range_low:
            bias = "BUY"
            last_event = f"min tomado en {fecha(c['time'])}"
    # El precio actual también puede tomar un extremo
    if current_bid >= range_high:
        bias = "SELL"
        last_event = "max tomado por precio actual"
    if current_bid <= range_low:
        bias = "BUY"
        last_event = "min tomado por precio actual"
    return bias, last_event

def main():
    if not mt5.initialize():
        print("Error: no se pudo conectar a MT5")
        return

    for symbol in SYMBOLS:
        tol = TOLERANCE_PIPS[symbol] * PIP
        tick = mt5.symbol_info_tick(symbol)
        bid = tick.bid if tick else 0

        print("\n" + "=" * 70)
        print(f"{symbol} | bid={bid:.5f} | tolerancia={TOLERANCE_PIPS[symbol]} pips")
        print("=" * 70)

        for tf_name, tf, count in [("DIARIO", mt5.TIMEFRAME_D1, 20), ("H4", mt5.TIMEFRAME_H4, 30)]:
            rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
            if rates is None or len(rates) < 3:
                print(f"\n[{tf_name}] Sin datos suficientes")
                continue

            candles = to_dicts(rates)
            closed = candles[:-1]   # excluir vela en formación
            forming = candles[-1]

            print(f"\n[{tf_name}] Vela en formación: {fecha(forming['time'])} (excluida)")
            ref, logs = find_reference(closed, tol)
            for line in logs:
                print(line)

            print(f"\n[{tf_name}] → RANGO SELECCIONADO: {fecha(ref['time'])}")
            print(f"           High={ref['high']:.5f} Low={ref['low']:.5f}")

            # Bias: evaluar velas posteriores al rango + precio actual
            ref_idx = closed.index(ref)
            after = closed[ref_idx + 1:] + [forming]
            bias, event = compute_bias(ref["high"], ref["low"], after, bid)
            if bias:
                target = ref["low"] if bias == "SELL" else ref["high"]
                print(f"[{tf_name}] → BIAS: {bias} ({event}) | objetivo: {target:.5f}")
            else:
                print(f"[{tf_name}] → BIAS: NEUTRO (ningún extremo tomado aún)")

    mt5.shutdown()

if __name__ == "__main__":
    main()