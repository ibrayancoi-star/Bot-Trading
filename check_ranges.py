import sys
import traceback
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass
print("Iniciando check_ranges...", flush=True)

try:
    import MetaTrader5 as mt5
    from datetime import datetime

    PIP = 0.0001
    SYMBOLS = ["EURUSD", "GBPUSD"]
    TOLERANCE_PIPS = {"EURUSD": 2.5, "GBPUSD": 3.0}

    def to_dict(r):
        return {"time": int(r["time"]), "open": float(r["open"]),
                "high": float(r["high"]), "low": float(r["low"]),
                "close": float(r["close"])}

    def fecha(ts):
        return datetime.fromtimestamp(ts).strftime("%d/%m %H:%M")

    def rango_pips(c):
        return round((c["high"] - c["low"]) / PIP, 1)

    def is_broken(cand, later, tol):
        h, l = cand["high"], cand["low"]
        low_taken = False
        high_taken = False
        
        for c in later:
            close = c["close"]
            # 1. Ruptura por cierre fuera de tolerancia
            if close > h + tol:
                return True, f"CLOSE roto >tol por {fecha(c['time'])} (close={close:.5f})"
            if close < l - tol:
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

    def find_structural(candles, tol):
        forming = candles[-1]
        closed = candles[:-1]
        evals = []
        first_valid = None
        for i in range(len(closed) - 1, -1, -1):
            cand = closed[i]
            later = closed[i+1:] + [forming]
            broken, reason = is_broken(cand, later, tol)
            evals.append((cand, broken, reason))
            if not broken and first_valid is None:
                first_valid = cand
        ref = first_valid if first_valid else closed[-1]
        return ref, evals

    if not mt5.initialize():
        print(f"mt5.initialize() falló: {mt5.last_error()}", flush=True)
        raise SystemExit

    print("MT5 conectado.\n", flush=True)

    for symbol in SYMBOLS:
        tol = TOLERANCE_PIPS[symbol] * PIP
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            print(f"No hay tick para {symbol}", flush=True)
            continue
        bid = tick.bid

        print("=" * 72, flush=True)
        print(f" {symbol} | bid = {bid:.5f} | tol = {TOLERANCE_PIPS[symbol]} pips", flush=True)
        print("=" * 72, flush=True)

        for tf_name, tf, count in [("H4", mt5.TIMEFRAME_H4, 60),
                                    ("D1", mt5.TIMEFRAME_D1, 30)]:
            rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
            if rates is None or len(rates) < 3:
                print(f"\n[{tf_name}] Sin datos\n", flush=True)
                continue

            candles = [to_dict(r) for r in rates]
            forming = candles[-1]
            last_closed = candles[-2]
            eq_c = last_closed["low"] + 0.5 * (last_closed["high"] - last_closed["low"])

            print(f"\n── {tf_name} ──", flush=True)
            print(f"  En formación: {fecha(forming['time'])} (ignorada)", flush=True)
            print(f"\n  CALENDARIO (bot): última cerrada", flush=True)
            print(f"    {fecha(last_closed['time'])} | "
                  f"H={last_closed['high']:.5f} L={last_closed['low']:.5f} "
                  f"EQ={eq_c:.5f} | {rango_pips(last_closed)} pips", flush=True)

            ref, evals = find_structural(candles, tol)
            print(f"\n  ESTRUCTURAL: evaluadas {len(evals)} velas", flush=True)
            for cand, broken, reason in evals:
                mark = "❌" if broken else "✅"
                tag = f" | {reason}" if broken else " ← válida"
                print(f"    {mark} {fecha(cand['time'])} "
                      f"H={cand['high']:.5f} L={cand['low']:.5f} "
                      f"({rango_pips(cand)} pips){tag}", flush=True)
            eq_s = ref["low"] + 0.5 * (ref["high"] - ref["low"])
            print(f"    → ELEGIDA: {fecha(ref['time'])} | "
                  f"H={ref['high']:.5f} L={ref['low']:.5f} "
                  f"EQ={eq_s:.5f} | {rango_pips(ref)} pips", flush=True)

            if last_closed["time"] == ref["time"]:
                print(f"\n  ✅ COINCIDEN", flush=True)
            else:
                print(f"\n  ⚠️  DIFIEREN: "
                      f"calendario={rango_pips(last_closed)}p vs "
                      f"estructural={rango_pips(ref)}p", flush=True)

        print("", flush=True)

    mt5.shutdown()
    print("Terminado.", flush=True)

except Exception:
    print("\n=== ERROR ===", flush=True)
    traceback.print_exc()