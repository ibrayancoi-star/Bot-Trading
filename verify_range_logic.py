# verify_range_logic.py — Selección estructural de rango (D1 + H4)
# Ejecutar: python verify_range_logic.py
# Solo lectura. No toca el bot.

import sys
import MetaTrader5 as mt5
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

TOLERANCE_PIPS = {"EURUSD": 2.5, "GBPUSD": 3.0}
PIP = 0.0001
SYMBOLS = ["EURUSD", "GBPUSD"]

def to_dict(r):
    return {"time": int(r["time"]), "open": float(r["open"]),
            "high": float(r["high"]), "low": float(r["low"]),
            "close": float(r["close"])}

def fecha(ts, fmt="%d/%m %H:%M"):
    return datetime.fromtimestamp(ts).strftime(fmt)

def is_broken(candidate, later_candles, tolerance):
    h, l = candidate["high"], candidate["low"]
    low_taken = False
    high_taken = False
    
    for c in later_candles:
        close = c["close"]
        # 1. Ruptura por cierre fuera de tolerancia
        if close > h + tolerance:
            return True, f"CLOSE roto >tol por {fecha(c['time'])} (close={close:.5f})"
        if close < l - tolerance:
            return True, f"CLOSE roto >tol por {fecha(c['time'])} (close={close:.5f})"
        
        # 2. Extremo opuesto alcanzado
        taken_low_this_candle = c["low"] <= l
        taken_high_this_candle = c["high"] >= h
        
        if taken_low_this_candle and taken_high_this_candle:
            return True, f"RANGO AGOTADO: ambos extremos tomados por {fecha(c['time'])}"
            
        if low_taken and taken_high_this_candle:
            return True, f"RANGO AGOTADO: HIGH posterior alcanzado por {fecha(c['time'])} tras tomar LOW"
            
        if high_taken and taken_low_this_candle:
            return True, f"RANGO AGOTADO: LOW posterior alcanzado por {fecha(c['time'])} tras tomar HIGH"
            
        if taken_low_this_candle:
            low_taken = True
        if taken_high_this_candle:
            high_taken = True
    return False, ""

def find_reference(candles, tolerance, tf_label):
    """
    Busca la última vela cerrada cuyo rango no fue roto.
    candles: lista ordenada por tiempo ascendente. La última es la EN FORMACIÓN.
    """
    forming = candles[-1]
    closed = candles[:-1]  # solo cerradas son candidatas

    print(f"[{tf_label}] Vela en formación: {fecha(forming['time'])} (no es candidata, sí evalúa)")
    print(f"[{tf_label}] Evaluando {len(closed)} velas cerradas:")
    print()

    # Recorrer desde la más reciente cerrada hacia atrás
    for i in range(len(closed) - 1, -1, -1):
        candidate = closed[i]
        # Las velas posteriores incluyen las cerradas siguientes Y la en formación
        later = closed[i+1:] + [forming]
        broken, reason = is_broken(candidate, later, tolerance)

        if broken:
            print(f"  {fecha(candidate['time'])} | H={candidate['high']:.5f} L={candidate['low']:.5f} | ❌ {reason}")
        else:
            print(f"  {fecha(candidate['time'])} | H={candidate['high']:.5f} L={candidate['low']:.5f} | ✅ VÁLIDA")
            return candidate

    # Fallback: ninguna válida, devolver la última cerrada
    return closed[-1]

def compute_bias(ref, candles_after, current_bid):
    """
    Bias: max tomado → SELL, min tomado → BUY.
    """
    bias = None
    event = ""
    for c in candles_after:
        if c["high"] >= ref["high"]:
            bias = "SELL"
            event = f"max tomado en {fecha(c['time'])}"
        if c["low"] <= ref["low"]:
            bias = "BUY"
            event = f"min tomado en {fecha(c['time'])}"
    if current_bid >= ref["high"]:
        bias = "SELL"
        event = "max tomado por precio actual"
    if current_bid <= ref["low"]:
        bias = "BUY"
        event = "min tomado por precio actual"
    return bias, event

def main():
    if not mt5.initialize():
        print("Error: no se pudo conectar a MT5")
        return

    for symbol in SYMBOLS:
        tol = TOLERANCE_PIPS[symbol] * PIP
        tick = mt5.symbol_info_tick(symbol)
        bid = tick.bid if tick else 0

        print("=" * 70)
        print(f" {symbol} | bid={bid:.5f} | tolerancia={TOLERANCE_PIPS[symbol]} pips")
        print("=" * 70)

        # D1: traer 30 velas
        for tf_name, tf, count in [("DIARIO", mt5.TIMEFRAME_D1, 30),
                                    ("H4", mt5.TIMEFRAME_H4, 60)]:
            print()
            rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
            if rates is None or len(rates) < 3:
                print(f"[{tf_name}] Sin datos suficientes")
                continue

            candles = [to_dict(r) for r in rates]
            ref = find_reference(candles, tol, tf_name)

            print()
            print(f"[{tf_name}] → RANGO SELECCIONADO: {fecha(ref['time'])}")
            print(f"           High={ref['high']:.5f} Low={ref['low']:.5f}")

            # Bias
            ref_idx = next(i for i, c in enumerate(candles) if c["time"] == ref["time"])
            after = candles[ref_idx + 1:]
            bias, event = compute_bias(ref, after, bid)
            if bias:
                target = ref["low"] if bias == "SELL" else ref["high"]
                print(f"[{tf_name}] → BIAS: {bias} ({event}) | objetivo: {target:.5f}")
            else:
                print(f"[{tf_name}] → BIAS: NEUTRO (ningún extremo tomado)")
            print()

    mt5.shutdown()

if __name__ == "__main__":
    main()