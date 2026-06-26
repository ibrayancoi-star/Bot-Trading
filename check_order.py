# check_order.py — Verifica por qué falla order_send sin ejecutar de verdad
# Usa order_check (validación) en vez de order_send (ejecución real)
import traceback
print("Iniciando...", flush=True)

try:
    import MetaTrader5 as mt5

    if not mt5.initialize():
        print(f"Error initialize: {mt5.last_error()}", flush=True)
        raise SystemExit

    print("MT5 conectado.\n", flush=True)

    symbol = "GBPUSD"
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)

    print(f"Símbolo: {symbol}", flush=True)
    print(f"  bid={tick.bid:.5f} ask={tick.ask:.5f}", flush=True)
    print(f"  point={info.point}", flush=True)
    print(f"  stops_level (puntos mínimos SL/TP): {info.trade_stops_level}", flush=True)
    print(f"  freeze_level: {info.trade_freeze_level}", flush=True)
    print("", flush=True)

    # Simular un SELL como el que falló el 16/06
    # SL arriba del precio, TP abajo (correcto para SELL)
    price = tick.bid
    sl = round(price + 50 * info.point, info.digits)   # 5 pips arriba
    tp = round(price - 50 * info.point, info.digits)   # 5 pips abajo

    print(f"Probando SELL: price={price:.5f} SL={sl:.5f} TP={tp:.5f}", flush=True)

    # Probar los modos de filling que el broker dice aceptar
    for fill_name, fill_val in [("FOK", mt5.ORDER_FILLING_FOK),
                                 ("IOC", mt5.ORDER_FILLING_IOC)]:
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": 0.1,
            "type": mt5.ORDER_TYPE_SELL,
            "price": price,
            "sl": sl,
            "tp": tp,
            "deviation": 20,
            "magic": 12345,
            "comment": "test_check",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": fill_val,
        }

        print(f"\n--- Probando con {fill_name} ---", flush=True)
        result = mt5.order_check(request)
        if result is None:
            print(f"  order_check devolvió None. last_error: {mt5.last_error()}", flush=True)
        else:
            print(f"  retcode: {result.retcode}", flush=True)
            print(f"  comment: {result.comment}", flush=True)
            print(f"  balance: {result.balance}, margin: {result.margin}", flush=True)
            # retcode 0 = válido, listo para enviar
            if result.retcode == 0:
                print(f"  ✅ {fill_name} VÁLIDO — order_send funcionaría", flush=True)
            else:
                print(f"  ❌ {fill_name} rechazado", flush=True)

    mt5.shutdown()
    print("\nTerminado.", flush=True)

except Exception:
    print("\n=== ERROR ===", flush=True)
    traceback.print_exc()