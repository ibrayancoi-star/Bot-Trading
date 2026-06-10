# diagnostic_crt.py — diagnóstico rápido del estado del scanner
# Ejecutar en paralelo al bridge: python diagnostic_crt.py

import asyncio
import websockets
import json
from datetime import datetime

async def diagnose():
    print("🔍 Diagnóstico CRT — conectando...\n")
    async with websockets.connect("ws://127.0.0.1:8000") as ws:
        anchors = {}
        ticks = {}
        signals = []
        start = datetime.now()

        async for raw in ws:
            msg = json.loads(raw)
            t = msg.get("type", "")
            elapsed = (datetime.now() - start).seconds

            if t == "tick":
                sym = msg.get("symbol", "?")
                bid = msg.get("bid", 0)
                ask = msg.get("ask", 0)
                ticks[sym] = {"bid": bid, "ask": ask, "count": ticks.get(sym, {}).get("count", 0) + 1}

                # Comparar con anchor si existe
                if sym in anchors:
                    a = anchors[sym]
                    h, l = a["high"], a["low"]
                    pos = "DENTRO"
                    if bid > h:
                        pos = f"⚡ SOBRE CRT_HIGH ({bid:.5f} > {h:.5f}) → debería disparar SELL"
                    elif ask < l:
                        pos = f"⚡ BAJO CRT_LOW ({ask:.5f} < {l:.5f}) → debería disparar BUY"
                    else:
                        dist_high = round((h - bid) / 0.0001, 1)
                        dist_low = round((bid - l) / 0.0001, 1)
                        pos = f"DENTRO (↑{dist_high} pips al High, ↓{dist_low} pips al Low)"

                    # Imprimir cada 10 segundos para no saturar
                    if ticks[sym]["count"] % 10 == 0:
                        print(f"  [{sym}] bid={bid:.5f} | {pos}")

            elif t == "anchor_update":
                sym = msg.get("symbol", "?")
                h = msg.get("high", 0)
                l = msg.get("low", 0)
                eq = msg.get("eq", 0)
                anchors[sym] = {"high": h, "low": l, "eq": eq}
                print(f"📌 ANCHOR {sym}: High={h:.5f} Low={l:.5f} EQ={eq:.5f}")

            elif t == "scanner_signal":
                action = msg.get("action", "?")
                sym = msg.get("symbol", "?")
                reason = msg.get("reason", "")
                direction = msg.get("direction", "")
                sweep_type = msg.get("sweep_type", "")
                signals.append(msg)
                icon = {"DETECTED": "⚡", "DISMISSED": "❌", "EXECUTED": "✅", "FAILED": "💥"}.get(action, "•")
                extra = f" [{sweep_type}]" if sweep_type else ""
                print(f"{icon} SEÑAL: {sym} {direction}{extra} → {action} | {reason}")

            elif t == "bot_status":
                active = msg.get("active", False)
                syms = msg.get("symbols", [])
                print(f"🤖 BOT: {'ACTIVO' if active else 'INACTIVO'} | Símbolos: {syms}")

            elif t == "risk_guard_alert":
                print(f"🛑 RISK GUARD: {msg.get('message', '')}")

            # Reporte cada 60 segundos
            if elapsed > 0 and elapsed % 60 == 0 and ticks:
                print(f"\n{'='*50}")
                print(f"REPORTE (minuto {elapsed // 60})")
                for sym, data in ticks.items():
                    print(f"  {sym}: {data['count']} ticks recibidos")
                    if sym in anchors:
                        a = anchors[sym]
                        print(f"    Anchor: H={a['high']:.5f} L={a['low']:.5f}")
                        print(f"    Último: bid={data['bid']:.5f}")
                print(f"  Señales totales: {len(signals)}")
                print(f"{'='*50}\n")

asyncio.run(diagnose())