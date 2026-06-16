# check_ranges.py — Diagnóstico de selección de rangos D1 y H4
# Ejecutar: python check_ranges.py (con MT5 abierto)
# Solo lectura. No toca el bot.

import MetaTrader5 as mt5
from datetime import datetime

SYMBOLS = ["EURUSD", "GBPUSD"]

def fecha(ts):
    return datetime.fromtimestamp(ts).strftime("%d/%m %H:%M")

def body(c):
    return max(c["open"], c["close"]), min(c["open"], c["close"])

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
        print(f" {symbol} | bid actual = {bid:.5f}")
        print(f"{'='*70}")

        # ═══════════ H4 — MÉTODO POR CALENDARIO ═══════════
        print(f"\n── H4 (método calendario del bot) ──")
        rates_h4 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H4, 0, 10)
        if rates_h4 is not None and len(rates_h4) >= 2:
            # El bot usa la penúltima vela H4 (la última cerrada)
            # según el calendario de anclaje
            for i in range(len(rates_h4) - 1, -1, -1):
                c = to_dict(rates_h4[i])
                es_actual = "(EN FORMACIÓN)" if i == len(rates_h4) - 1 else ""
                es_anchor = " ← ANCHOR ACTUAL" if i == len(rates_h4) - 2 else ""
                print(f"  {fecha(c['time'])} | H={c['high']:.5f} L={c['low']:.5f} "
                      f"O={c['open']:.5f} C={c['close']:.5f} {es_actual}{es_anchor}")

            anchor = to_dict(rates_h4[-2])
            eq = anchor["low"] + 0.5 * (anchor["high"] - anchor["low"])
            rango_pips = round((anchor["high"] - anchor["low"]) / 0.0001, 1)
            dist_h = round((anchor["high"] - bid) / 0.0001, 1)
            dist_l = round((bid - anchor["low"]) / 0.0001, 1)
            print(f"\n  → BOT USA: H4 {fecha(anchor['time'])} | H={anchor['high']:.5f} "
                  f"L={anchor['low']:.5f} EQ={eq:.5f}")
            print(f"    Rango: {rango_pips} pips | Precio: ↑{dist_h} al High, ↓{dist_l} al Low")
            if bid > anchor["high"]:
                print(f"    ⚡ PRECIO SOBRE CRT_HIGH → sweep SELL")
            elif bid < anchor["low"]:
                print(f"    ⚡ PRECIO BAJO CRT_LOW → sweep BUY")
            else:
                print(f"    Precio DENTRO del rango")

        # ═══════════ D1 — MÉTODO ACTUAL DEL BOT ═══════════
        print(f"\n── D1 (método emit_daily_range del bot) ──")
        rates_d1 = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_D1, 0, 15)
        if rates_d1 is not None and len(rates_d1) >= 3:
            candles = [to_dict(r) for r in rates_d1]
            forming = candles[-1]
            closed = candles[:-1]

            print(f"  Vela en formación: {fecha(forming['time'])} (excluida de candidatas)")
            print(f"  Evaluando {len(closed)} velas cerradas:\n")

            reference = None
            for i in range(len(closed) - 1, -1, -1):
                c = closed[i]
                wh = c["high"]
                wl = c["low"]

                # Verificar contención de precio
                if bid > wh or bid < wl:
                    print(f"  {fecha(c['time'])} | H={wh:.5f} L={wl:.5f} | "
                          f"⏭️ Precio fuera del rango")
                    continue

                # Verificar si alguna vela cerrada posterior rompió con cuerpo
                superado = False
                rota_por = ""
                for j in range(i + 1, len(closed)):
                    bt, bb = body(closed[j])
                    if bt > wh:
                        superado = True
                        rota_por = f"HIGH roto por cuerpo {fecha(closed[j]['time'])} ({bt:.5f} > {wh:.5f})"
                        break
                    if bb < wl:
                        superado = True
                        rota_por = f"LOW roto por cuerpo {fecha(closed[j]['time'])} ({bb:.5f} < {wl:.5f})"
                        break

                if superado:
                    print(f"  {fecha(c['time'])} | H={wh:.5f} L={wl:.5f} | ❌ {rota_por}")
                else:
                    print(f"  {fecha(c['time'])} | H={wh:.5f} L={wl:.5f} | ✅ VÁLIDA")
                    reference = c
                    break

            if reference:
                print(f"\n  → BOT USA: D1 {fecha(reference['time'])} | "
                      f"H={reference['high']:.5f} L={reference['low']:.5f}")
            else:
                fb = closed[-1]
                print(f"\n  → FALLBACK: D1 {fecha(fb['time'])} | "
                      f"H={fb['high']:.5f} L={fb['low']:.5f}")

    mt5.shutdown()
    print(f"\n{'='*70}")
    print("Compara estos valores con lo que ves en el gráfico.")
    print("Si algún rango es incorrecto, indica qué vela debería")
    print("ser la correcta y por qué.")
    print(f"{'='*70}")

if __name__ == "__main__":
    main()