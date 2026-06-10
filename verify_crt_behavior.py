# verify_crt_behavior.py
# Ejecutar aparte: python verify_crt_behavior.py
# Escucha el WebSocket y audita el comportamiento CRT en tiempo real

import asyncio
import websockets
import json
from datetime import datetime
from collections import defaultdict

REPORT = defaultdict(list)
ANCHOR_HISTORY = []
SIGNAL_HISTORY = []

def analyze_anchor(msg):
    """Verifica que la vela H4 corresponde al calendario CRT."""
    crt_high = msg.get("crt_high")
    crt_low  = msg.get("crt_low")
    eq       = msg.get("eq")
    
    if crt_high and crt_low:
        eq_calculado = crt_low + 0.5 * (crt_high - crt_low)
        eq_correcto  = abs(eq_calculado - eq) < 0.00001 if eq else False
        
        ANCHOR_HISTORY.append({
            "time": datetime.now().isoformat(),
            "crt_high": crt_high,
            "crt_low": crt_low,
            "eq_recibido": eq,
            "eq_calculado": round(eq_calculado, 5),
            "eq_correcto": eq_correcto,
            "rango_pips": round((crt_high - crt_low) / 0.0001, 1)
        })
        
        if not eq_correcto:
            print(f"⚠️  EQ INCORRECTO: recibido={eq} calculado={eq_calculado}")
        else:
            print(f"✅ Anchor actualizado: H={crt_high} L={crt_low} EQ={eq} "
                  f"({ANCHOR_HISTORY[-1]['rango_pips']} pips)")

def analyze_signal(msg):
    """Audita cada evaluación de señal."""
    result   = msg.get("result", "?")
    symbol   = msg.get("symbol", "?")
    sweep    = msg.get("sweep_detected", False)
    kz       = msg.get("killzone_active", False)
    hr       = msg.get("hard_rules_passed", False)
    chroma   = msg.get("chromadb_score")
    reason   = msg.get("dismiss_reason", "")
    
    entry = {
        "time": datetime.now().strftime("%H:%M:%S"),
        "symbol": symbol,
        "result": result,
        "sweep": sweep,
        "killzone": kz,
        "hard_rules": hr,
        "chroma_score": chroma,
        "reason": reason
    }
    SIGNAL_HISTORY.append(entry)
    
    icon = "✅" if result == "APPROVED" else "❌"
    print(f"{icon} [{entry['time']}] {symbol} | sweep={sweep} kz={kz} "
          f"hr={hr} chroma={chroma} → {result} {reason}")

def print_report():
    print("\n" + "="*60)
    print("REPORTE CRT — RESUMEN DE SESIÓN")
    print("="*60)
    
    # Anclas
    print(f"\n📌 VELAS H4 DE ANCLAJE OBSERVADAS: {len(ANCHOR_HISTORY)}")
    for a in ANCHOR_HISTORY:
        print(f"   {a['time']} | H={a['crt_high']} L={a['crt_low']} "
              f"EQ_ok={a['eq_correcto']} | {a['rango_pips']} pips")
    
    # Señales
    total     = len(SIGNAL_HISTORY)
    approved  = sum(1 for s in SIGNAL_HISTORY if s["result"] == "APPROVED")
    dismissed = total - approved
    
    print(f"\n📊 SEÑALES EVALUADAS: {total}")
    print(f"   Aprobadas:  {approved}")
    print(f"   Rechazadas: {dismissed}")
    
    if dismissed > 0:
        razones = defaultdict(int)
        for s in SIGNAL_HISTORY:
            if s["result"] != "APPROVED" and s["reason"]:
                razones[s["reason"]] += 1
        print("\n   Razones de rechazo:")
        for r, count in sorted(razones.items(), key=lambda x: -x[1]):
            print(f"   → {r}: {count} veces")
    
    # Detectar sweep por tick (problema principal)
    sweeps_sin_confirmacion = [
        s for s in SIGNAL_HISTORY 
        if s["sweep"] and s.get("sweep_type") is None
    ]
    if sweeps_sin_confirmacion:
        print(f"\n⚠️  SWEEPS SIN CLASIFICACIÓN TBS/TWS: {len(sweeps_sin_confirmacion)}")
        print("   → El bot está detectando sweeps por tick, sin confirmación de vela")
    else:
        print("\n✅ Todos los sweeps tienen clasificación TBS/TWS")

async def listen():
    print("🔍 Conectando al bridge... (Ctrl+C para reporte final)\n")
    try:
        async with websockets.connect("ws://127.0.0.1:8000") as ws:
            async for raw in ws:
                msg = json.loads(raw)
                t   = msg.get("type", "")
                
                if t == "anchor_update":
                    analyze_anchor(msg)
                elif t == "signal_evaluation":
                    analyze_signal(msg)
                else:
                    if t == "positions":
        # Solo mostrar cada 30 mensajes para no saturar
                        REPORT["positions_count"] = REPORT.get("positions_count", [0])
                        REPORT["positions_count"][0] += 1
                        if REPORT["positions_count"][0] % 30 == 0:
                            print(f"   [positions] × {REPORT['positions_count'][0]} recibidos")
                    else:
                        print(f"   [{t}]")
                # tick, positions, history → ignorados
                    
    except KeyboardInterrupt:
        print_report()
    except Exception as e:
        print(f"Error de conexión: {e}")
        print("¿Está el bridge ejecutándose en ws://127.0.0.1:8000?")

asyncio.run(listen())