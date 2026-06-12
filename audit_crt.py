# audit_crt.py — auditoría de metodología CRT activa
# Ejecutar: python audit_crt.py

import asyncio
import websockets
import json

async def audit():
    print("🔍 Auditoría CRT — esperando BOT_CONFIG_UPDATE...\n")
    async with websockets.connect("ws://127.0.0.1:8000") as ws:
        async for raw in ws:
            msg = json.loads(raw)

            if msg.get("type") == "bot_status":
                active = msg.get("active", False)
                syms = msg.get("symbols", [])
                print(f"Bot: {'ACTIVO' if active else 'INACTIVO'} | Símbolos: {syms}\n")

            if msg.get("action") == "BOT_CONFIG_UPDATE" or "strategy" in str(msg.get("payload", {})):
                p = msg.get("payload", msg)
                print("=" * 60)
                print("AUDITORÍA DE METODOLOGÍA CRT")
                print("=" * 60)

                print("\n── METODOLOGÍA BASE ──")
                print(f"  Estrategia seleccionada:  {p.get('strategy', '?')}")
                print(f"  (efecto real: NINGUNO — selector decorativo)")

                print("\n── DETECCIÓN DE SWEEP ──")
                rcc = p.get('requireCandleConfirmation', p.get('require_candle_confirmation', False))
                print(f"  Confirmación por vela:    {'✅ ON → TBS/TWS activo' if rcc else '❌ OFF → sweep por tick (1 solo tick)'}")
                print(f"  Multiplicador TBS:        {p.get('modelTbsRiskMultiplier', '?')}x {'(se aplica)' if rcc else '(NO se aplica sin confirmación)'}")
                print(f"  Multiplicador TWS:        {p.get('modelTwsRiskMultiplier', '?')}x {'(se aplica)' if rcc else '(NO se aplica sin confirmación)'}")

                print("\n── GESTIÓN DE RIESGO ──")
                dsl = p.get('useDynamicSl', p.get('use_dynamic_sl', False))
                crt_t = p.get('useCrtTargets', p.get('use_crt_targets', False))
                pceq = p.get('partialCloseAtEq', p.get('partial_close_at_eq', False))
                print(f"  SL dinámico (mecha):      {'✅ ON → SL detrás de mecha vela_2' if dsl else '❌ OFF → SL fijo en pips'}")
                print(f"  SL fijo:                  {p.get('stopLossPips', '?')} pips {'(ignorado si SL dinámico ON)' if dsl else '(ACTIVO)'}")
                print(f"  Targets CRT (EQ/extremo): {'✅ ON → TP1=EQ, TP2=extremo' if crt_t else '❌ OFF → TP fijo en pips'}")
                print(f"  TP fijo:                  {p.get('takeProfitPips', '?')} pips {'(ignorado si targets ON)' if crt_t else '(ACTIVO)'}")
                print(f"  Cierre parcial en EQ:     {'✅ ON → 50% en EQ + SL breakeven' if pceq else '❌ OFF → sin cierre parcial'}")
                print(f"  Trailing stop:            ❌ DECORATIVO (sin lógica implementada)")

                print("\n── FILTROS ──")
                smt = p.get('smtDivergenceEnabled', p.get('smt_divergence_enabled', False))
                hyb = p.get('hybridM1M15Confluence', False)
                print(f"  SMT Divergence:           {'✅ ON → requiere divergencia EURUSD/GBPUSD' if smt else '❌ OFF'}")
                print(f"  Confluencia M1/M15:       ❌ DECORATIVO (flag guardado, sin lógica)")
                print(f"  Filtro de spread:         {'BYPASS' if p.get('disableSpreadFilter', False) else 'ACTIVO (20% del ATR)'}")
                print(f"  Filtro de ATR:            {'BYPASS' if p.get('disableAtrFilter', False) else 'ACTIVO'}")
                print(f"  Filtro mecha CRT:         {'BYPASS' if p.get('disableWickBodyFilter', False) else 'ACTIVO'}")
                print(f"  Filtro dimensión:         {'BYPASS' if p.get('disableDimensionFilter', False) else 'ACTIVO'}")

                print("\n── CHROMADB ──")
                print(f"  Umbral:                   {p.get('chromaThreshold', '?')}")
                print(f"  Top K:                    {p.get('chromaTopK', '?')}")
                print(f"  ⚠️  PROBLEMA ACTIVO: bloquea señales por contaminación cruzada")
                print(f"     (LOSS de EURUSD bloquea señales de GBPUSD)")

                print("\n── RISK GUARD ──")
                print(f"  Pérdida diaria máx:       {p.get('maxDailyLoss', '?')}%")
                print(f"  Max posiciones:           {p.get('maxPositions', '?')}")

                print("\n── RESUMEN ──")
                real_crt = rcc and dsl and crt_t
                partial_crt = rcc or dsl or crt_t
                if real_crt:
                    print("  📊 METODOLOGÍA CRT COMPLETA ACTIVA")
                elif partial_crt:
                    activos = []
                    if rcc: activos.append("TBS/TWS")
                    if dsl: activos.append("SL dinámico")
                    if crt_t: activos.append("Targets CRT")
                    if pceq: activos.append("Cierre parcial EQ")
                    print(f"  🔶 CRT PARCIAL: {', '.join(activos)}")
                    print(f"     Falta activar: {', '.join([x for x, v in [('TBS/TWS', rcc), ('SL dinámico', dsl), ('Targets CRT', crt_t)] if not v])}")
                else:
                    print("  ❌ CRT NO ACTIVO — el bot opera con sweep por tick y SL/TP fijos")
                    print("     Para activar CRT real, enciende en la UI:")
                    print("     1. Confirmación por Vela (TBS/TWS)")
                    print("     2. Usar SL Dinámico")
                    print("     3. Usar Objetivos CRT")

                print("=" * 60)

            # Solo necesitamos un config update, luego seguimos escuchando señales
            if msg.get("type") == "scanner_signal":
                a = msg.get("action", "?")
                s = msg.get("symbol", "?")
                d = msg.get("direction", "")
                r = msg.get("reason", "")
                st = msg.get("sweep_type", "")
                icon = {"DETECTED": "⚡", "DISMISSED": "❌", "EXECUTED": "✅", "FAILED": "💥"}.get(a, "•")
                extra = f" [{st}]" if st else " [tick-based]"
                print(f"\n{icon} {s} {d}{extra} → {a}")
                if r:
                    print(f"   Razón: {r}")

asyncio.run(audit())