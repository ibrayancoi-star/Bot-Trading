# check_filling.py — Diagnóstico de modos de filling del broker
# Ejecutar con MT5 abierto: python check_filling.py
import traceback
print("Iniciando...", flush=True)

try:
    import MetaTrader5 as mt5

    if not mt5.initialize():
        print(f"Error initialize: {mt5.last_error()}", flush=True)
        raise SystemExit

    print("MT5 conectado.\n", flush=True)

    # Mapeo de constantes para legibilidad
    EXEMODE = {
        0: "REQUEST", 1: "INSTANT", 2: "MARKET", 3: "EXCHANGE"
    }

    for symbol in ["EURUSD", "GBPUSD"]:
        info = mt5.symbol_info(symbol)
        if info is None:
            print(f"{symbol}: símbolo no encontrado", flush=True)
            continue

        print("=" * 60, flush=True)
        print(f" {symbol}", flush=True)
        print("=" * 60, flush=True)

        # filling_mode es un bitmask: 1=FOK, 2=IOC, 4=RETURN
        fm = info.filling_mode
        modos = []
        if fm & 1:
            modos.append("FOK (1)")
        if fm & 2:
            modos.append("IOC (2)")
        if fm & 4:
            modos.append("RETURN (4)")

        print(f"  filling_mode (bitmask): {fm}", flush=True)
        print(f"  → Modos aceptados: {', '.join(modos) if modos else 'NINGUNO?'}", flush=True)

        exe = info.trade_exemode
        print(f"  trade_exemode: {exe} ({EXEMODE.get(exe, '?')})", flush=True)
        print(f"  trade_mode: {info.trade_mode} "
              f"(0=disabled, 4=full)", flush=True)
        print(f"  volume_min: {info.volume_min}", flush=True)
        print(f"  volume_max: {info.volume_max}", flush=True)
        print(f"  volume_step: {info.volume_step}", flush=True)

        # Recomendación según el bitmask
        print(f"\n  → RECOMENDACIÓN:", flush=True)
        if fm & 1:
            print(f"     Usar ORDER_FILLING_FOK", flush=True)
        elif fm & 2:
            print(f"     Usar ORDER_FILLING_IOC", flush=True)
        elif fm & 4:
            print(f"     Usar ORDER_FILLING_RETURN", flush=True)
        else:
            print(f"     ⚠️ filling_mode no expone bits estándar.", flush=True)
            print(f"     Probablemente este broker usa execution "
                  f"por '{EXEMODE.get(exe, '?')}'", flush=True)
        print("", flush=True)

    mt5.shutdown()
    print("Terminado.", flush=True)

except Exception:
    print("\n=== ERROR ===", flush=True)
    traceback.print_exc()