"""
crt_engine.py — Núcleo PURO de la estrategia CRT.

Fuente de verdad ÚNICA compartida por el motor en vivo (mt5_bridge.py) y el backtest
(backtesting_engine.py). NO depende de MetaTrader5, asyncio, variables globales ni del reloj de
pared: todo entra por parámetros (velas, estado previo, `now`) y todo sale como valores.

Así, optimizar la lógica aquí se refleja automáticamente en DEMO y en BACKTEST.

Convenciones de "vela" (candle): dict-like con claves "open","high","low","close","time" y
opcionalmente "tick_volume". Acepta tanto dicts como registros numpy de MT5 (acceso por subíndice).
Las listas de velas van en orden ascendente por tiempo (más antigua primero).
"""

from crt_logic import (
    is_accumulation_candle,
    classify_sweep_type,
    calculate_dynamic_sl,
    calculate_crt_targets,
    check_smt_divergence,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers de rango (movidos desde mt5_bridge.py — regla única CRT)
# ──────────────────────────────────────────────────────────────────────────────

def range_broken_by_body(cand_high: float, cand_low: float, later) -> bool:
    """
    Invalida la vela si alguna posterior excede sus extremos con CUERPO (cierre real).
    Mechas NO invalidan: en CRT son barridos esperados.
    IMPORTANTE: `later` debe contener SOLO velas CERRADAS. La vela en formación NO invalida
    (no ha cerrado: la regla exige que una vela "CIERRE" con cuerpo por encima/debajo).
    """
    for c in later:
        body_top = max(float(c["open"]), float(c["close"]))
        body_bot = min(float(c["open"]), float(c["close"]))
        if body_top > cand_high or body_bot < cand_low:
            return True
    return False


def extremes_taken(ref_high: float, ref_low: float, after) -> tuple:
    """
    Devuelve (high_taken, low_taken): si el high/low del rango fue tocado (con mecha basta)
    por alguna vela posterior. `after` debe incluir las posteriores Y la vela en formación.
    Sirve para el ciclo CRT: cuando AMBOS extremos han sido tomados, el rango se cierra.
    """
    high_taken = False
    low_taken = False
    for c in after:
        if float(c["high"]) >= ref_high:
            high_taken = True
        if float(c["low"]) <= ref_low:
            low_taken = True
    return high_taken, low_taken


def compute_range_bias(ref_high: float, ref_low: float, after, current_price: float) -> str:
    """
    Bias direccional de un rango: high tomado -> SELL (reversión bajista esperada), low -> BUY.
    Gana el último extremo tomado; el precio actual tiene la última palabra.
    `after` debe incluir las velas posteriores al rango Y la vela en formación.
    """
    bias = "NEUTRO"
    for c in after:
        if float(c["high"]) >= ref_high:
            bias = "SELL"
        if float(c["low"]) <= ref_low:
            bias = "BUY"
    if current_price >= ref_high:
        bias = "SELL"
    if current_price <= ref_low:
        bias = "BUY"
    return bias


# Aliases de compatibilidad con los nombres internos previos de mt5_bridge.py
_h4_range_broken = range_broken_by_body
_extremes_taken = extremes_taken
_compute_range_bias = compute_range_bias


# ──────────────────────────────────────────────────────────────────────────────
# Selección de rango (unifica update_reference_ranges / emit_daily_range)
# ──────────────────────────────────────────────────────────────────────────────

def select_range(closed, forming, prev_state, current_price,
                 *, compute_accumulation: bool = False,
                 atr_price: float = 0.0, vol_ma: float = 0.0):
    """
    Selecciona el rango CRT activo (regla única, idéntica para H4 y D1).

    Parámetros:
      closed: velas CERRADAS candidatas (ascendente).
      forming: vela en formación (cuenta para extremos/bias, NO es candidata ni invalida por cuerpo)
               o None.
      prev_state: estado previo {high, low, ref_ts, high_taken, low_taken, accumulation} o None.
      current_price: precio actual (bid en vivo / close de la vela en backtest) para el bias.
      compute_accumulation: si True calcula el flag informativo is_accumulation_candle (H4).
      atr_price, vol_ma: insumos de acumulación (solo si compute_accumulation).

    Regla:
      1. STICKY: mantener el rango previo mientras NO esté roto por el CUERPO de una vela CERRADA
         posterior NI con el ciclo completo (ambos extremos tomados).
      2. Si no hay previo o se invalida: la vela CERRADA más reciente cuyo máx/mín NO haya sido
         superado por el CUERPO de cerradas posteriores. Sin contención de precio, sin acumulación.

    Devuelve dict {high, low, eq, ref_ts, bias, high_taken, low_taken, accumulation, kept} o None.
    """
    if not len(closed):
        return None

    reference = None
    kept = False

    if prev_state:
        ph = float(prev_state.get("high", 0.0))
        pl = float(prev_state.get("low", 0.0))
        pts = int(prev_state.get("ref_ts", 0) or 0)
        if ph > 0.0 and pl > 0.0 and pts > 0:
            closed_after = [c for c in closed if int(c["time"]) > pts]
            after_prev = list(closed_after)
            if forming is not None:
                after_prev = after_prev + [forming]
            rota = range_broken_by_body(ph, pl, closed_after) if closed_after else False
            h_taken, l_taken = extremes_taken(ph, pl, after_prev)
            if not rota and not (h_taken and l_taken):
                reference = {"high": ph, "low": pl, "time": pts,
                             "open": float(prev_state.get("open", 0.0)),
                             "close": float(prev_state.get("close", 0.0))}
                kept = True

    if reference is None:
        first_valid = None
        for i in range(len(closed) - 1, -1, -1):
            cand = closed[i]
            cand_high = float(cand["high"])
            cand_low = float(cand["low"])
            later_closed = list(closed[i + 1:])  # solo CERRADAS; forming no invalida
            if range_broken_by_body(cand_high, cand_low, later_closed):
                continue
            first_valid = cand
            break
        reference = first_valid if first_valid is not None else closed[-1]

    high = float(reference["high"])
    low = float(reference["low"])
    ref_time = int(reference["time"])
    ref_open = float(reference["open"])
    ref_close = float(reference["close"])
    eq = low + 0.5 * (high - low)

    after = [c for c in closed if int(c["time"]) > ref_time]
    if forming is not None:
        after = after + [forming]
    bias = compute_range_bias(high, low, after, current_price)
    high_taken, low_taken = extremes_taken(high, low, after)

    if kept and prev_state is not None:
        accumulation = bool(prev_state.get("accumulation", False))
    elif compute_accumulation:
        accumulation = bool(is_accumulation_candle(
            reference, atr_price, float(reference["tick_volume"]), vol_ma))
    else:
        accumulation = False

    return {
        "high": high, "low": low, "eq": eq, "ref_ts": ref_time, "bias": bias,
        "ref_open": ref_open, "ref_close": ref_close,
        "high_taken": high_taken, "low_taken": low_taken,
        "accumulation": accumulation, "kept": kept,
    }
