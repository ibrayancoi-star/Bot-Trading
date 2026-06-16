# replay_missed.py — Reconstruir condiciones que el bot vio/ignoró
# Ejecutar: python replay_missed.py

import MetaTrader5 as mt5
from datetime import datetime, timedelta

SYMBOLS = ["EURUSD", "GBPUSD"]

def fecha(ts):
    return datetime.fromtimestamp(ts).strftime("%d/%m %H:%M")

def body_range(c):
    return max(c["open"], c["close"]), min(c["open"], c["close"])

def detect_fvg(candles):
    """Detectar FVGs en una serie de velas."""
    fvgs = []
    for i in range(len(candles) - 2):
        c1, c3 = candles[i], candles[i + 2]
        if c3["low"] > c1["high"]:
            fvgs.append({"type": "BULLISH", "top": c3["low"],
                         "bottom": c1["high"], "time": candles[i+1]["time"]})
        if c3["high"] < c1["low"]:
            fvgs.append({"type": "BEARISH", "top": c1["low"],
                         "bottom": c3["high"], "time": candles[i+1]["time"]})
    return fvgs

def detect_ifvg(fvgs, candles):
    """Detectar IFVGs: FVGs que fueron rellenados y luego respetados."""
    ifvgs = []
    for fvg in fvgs:
        filled = False
        respected_after_fill = False
        for c in candles:
            if c["time"] <= fvg["time"]:
                continue
            if not filled:
                if fvg["type"] == "BULLISH" and c["low"] <= fvg["bottom"]:
                    filled = True
                elif fvg["type"] == "BEARISH" and c["high"] >= fvg["top"]:
                    filled = True
            else:
                if fvg["type"] == "BULLISH" and c["close"] > fvg["bottom"]:
                    respected_after_fill = True
                    break
                elif fvg["type"] == "BEARISH" and c["close"] < fvg["top"]:
                    respected_after_fill = True
                    break
        if filled and respected_after_fill:
            ifvgs.append(fvg)
    return ifvgs

def to_dict(r):
    return {"time": int(r["time"]), "open": float(r["open"]),
            "high": float(r["high"]), "low": float(r["low"]),
            "close": float(r["close"])}

def main():
    if not mt5.initialize():
        print("Error: no se pudo conectar a MT5")
        return

    for symbol in SYMBOLS:
        tick = mt5.symbol_info_tick(symbol)
        bid = tick.bid if tick else 0

        print(f"\n{'='*70}")
        print(f" REPLAY: {symbol} | bid={bid:.5f}")
        print(f"{'='*70}")

        # H4 anchor actual del bot
        rates_h4 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H4, 0, 10)
        if rates_h4 is None or len(rates_h4) < 3:
            print("  Sin datos H4")
            continue

        h4_candles = [to_dict(r) for r in rates_h4]
        anchor = h4_candles[-2]
        crt_h = anchor["high"]
        crt_l = anchor["low"]
        eq = crt_l + 0.5 * (crt_h - crt_l)

        print(f"\n── H4 ANCHOR (lo que usa el bot) ──")
        print(f"  Vela: {fecha(anchor['time'])} | H={crt_h:.5f} L={crt_l:.5f} EQ={eq:.5f}")

        # D1 referencia
        rates_d1 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_D1, 1, 5)
        if rates_d1 is not None and len(rates_d1) > 0:
            d1 = to_dict(rates_d1[-1])
            print(f"\n── D1 (última cerrada) ──")
            print(f"  Vela: {fecha(d1['time'])} | H={d1['high']:.5f} L={d1['low']:.5f}")

            # ¿Confluencia D1↔H4?
            d1_contains_h4 = d1["low"] <= crt_l and d1["high"] >= crt_h
            h4_near_d1_low = abs(crt_l - d1["low"]) < 0.0020
            h4_near_d1_high = abs(crt_h - d1["high"]) < 0.0020
            print(f"\n── CONFLUENCIA D1↔H4 ──")
            print(f"  D1 contiene H4: {'SÍ' if d1_contains_h4 else 'NO'}")
            print(f"  H4 Low cerca de D1 Low: {'SÍ' if h4_near_d1_low else 'NO'} "
                  f"(diff={abs(crt_l - d1['low'])/0.0001:.1f} pips)")
            print(f"  H4 High cerca de D1 High: {'SÍ' if h4_near_d1_high else 'NO'} "
                  f"(diff={abs(crt_h - d1['high'])/0.0001:.1f} pips)")

        # Sweeps en las últimas horas (M1)
        rates_m1 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 240)
        if rates_m1 is not None and len(rates_m1) > 10:
            m1_candles = [to_dict(r) for r in rates_m1]

            print(f"\n── SWEEPS DETECTADOS (últimas 4h en M1) ──")
            sweeps_found = 0
            for i, c in enumerate(m1_candles):
                if c["high"] > crt_h:
                    sweeps_found += 1
                    # Verificar TBS/TWS
                    body_t, body_b = body_range(c)
                    body_crossed = body_t > crt_h
                    wick_only = c["high"] > crt_h and body_t <= crt_h
                    tipo = "TBS" if body_crossed else "TWS"

                    # Vela siguiente regresó?
                    reclaimed = False
                    if i + 1 < len(m1_candles):
                        next_c = m1_candles[i + 1]
                        if next_c["close"] < crt_h:
                            reclaimed = True

                    status = f"{tipo} {'+ Vela3 ✅' if reclaimed else '(sin confirmación)'}"
                    print(f"  ⚡ {fecha(c['time'])} | high={c['high']:.5f} > CRT_H={crt_h:.5f} "
                          f"| {status}")

                if c["low"] < crt_l:
                    sweeps_found += 1
                    body_t, body_b = body_range(c)
                    body_crossed = body_b < crt_l
                    tipo = "TBS" if body_crossed else "TWS"

                    reclaimed = False
                    if i + 1 < len(m1_candles):
                        next_c = m1_candles[i + 1]
                        if next_c["close"] > crt_l:
                            reclaimed = True

                    status = f"{tipo} {'+ Vela3 ✅' if reclaimed else '(sin confirmación)'}"
                    print(f"  ⚡ {fecha(c['time'])} | low={c['low']:.5f} < CRT_L={crt_l:.5f} "
                          f"| {status}")

            if sweeps_found == 0:
                print(f"  Ningún sweep de H4 en las últimas 4 horas")

            # FVGs en M5
            print(f"\n── FVG / IFVG (M5, últimas 4h) ──")
            rates_m5 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M5, 0, 100)
            if rates_m5 is not None and len(rates_m5) > 5:
                m5_candles = [to_dict(r) for r in rates_m5]
                fvgs = detect_fvg(m5_candles)
                ifvgs = detect_ifvg(fvgs, m5_candles)

                active_fvgs = []
                for fvg in fvgs:
                    filled = any(
                        (c["low"] <= fvg["bottom"] if fvg["type"] == "BULLISH"
                         else c["high"] >= fvg["top"])
                        for c in m5_candles if c["time"] > fvg["time"]
                    )
                    if not filled:
                        active_fvgs.append(fvg)

                print(f"  FVGs totales: {len(fvgs)} | Activos (sin rellenar): "
                      f"{len(active_fvgs)} | IFVGs: {len(ifvgs)}")

                for fvg in active_fvgs[-5:]:
                    near_crt = ""
                    if abs(fvg["top"] - crt_h) < 0.0010 or abs(fvg["bottom"] - crt_h) < 0.0010:
                        near_crt = " ← CERCA DE CRT_HIGH"
                    if abs(fvg["top"] - crt_l) < 0.0010 or abs(fvg["bottom"] - crt_l) < 0.0010:
                        near_crt = " ← CERCA DE CRT_LOW"
                    print(f"    {fvg['type']} | {fecha(fvg['time'])} | "
                          f"top={fvg['top']:.5f} bot={fvg['bottom']:.5f}{near_crt}")

                for ifvg in ifvgs[-3:]:
                    print(f"    IFVG {ifvg['type']} | {fecha(ifvg['time'])} | "
                          f"top={ifvg['top']:.5f} bot={ifvg['bottom']:.5f}")

                # ¿El bot evalúa FVG/IFVG?
                print(f"\n  ⚠️ EL BOT NO EVALÚA FVG/IFVG COMO FILTRO OPERATIVO")
                print(f"     Solo se dibujan en el gráfico (visual)")

            # ¿Max/min de rango D1 tomado?
            if rates_d1 is not None and len(rates_d1) > 0:
                print(f"\n── RANGO D1: ¿EXTREMOS TOMADOS? ──")
                d1_h_taken = any(c["high"] >= d1["high"] for c in m1_candles)
                d1_l_taken = any(c["low"] <= d1["low"] for c in m1_candles)
                print(f"  D1 High ({d1['high']:.5f}): "
                      f"{'⚡ TOMADO' if d1_h_taken else 'No tocado'}")
                print(f"  D1 Low ({d1['low']:.5f}): "
                      f"{'⚡ TOMADO' if d1_l_taken else 'No tocado'}")
                if d1_h_taken and not d1_l_taken:
                    print(f"  → Bias implícito: SELL (max tomado, min pendiente)")
                elif d1_l_taken and not d1_h_taken:
                    print(f"  → Bias implícito: BUY (min tomado, max pendiente)")
                elif d1_h_taken and d1_l_taken:
                    print(f"  → Ambos extremos tomados (rango agotado)")
                else:
                    print(f"  → Ningún extremo tomado (rango fresco)")

                print(f"\n  ⚠️ EL BOT NO USA D1 COMO FILTRO OPERATIVO")
                print(f"     No filtra por bias D1 ni confluencia D1↔H4")

    mt5.shutdown()
    print(f"\n{'='*70}")
    print("RESUMEN: El bot solo opera con H4 anchor + filtros Capa 1 + ChromaDB.")
    print("NO evalúa: FVG/IFVG, confluencia fractal, bias D1, ni max/min D1.")
    print("Estas condiciones existen en el mercado pero el bot las ignora.")
    print(f"{'='*70}")

if __name__ == "__main__":
    main()