import datetime
import json
import os
from zoneinfo import ZoneInfo

def get_anchor_candle_params(now_canary: datetime.datetime) -> tuple[int, str]:
    """Determines the target start hour in Canary time and the label for the anchor candle."""
    current_hour = now_canary.hour
    if current_hour >= 14 or current_hour < 6:
        return 10, "14:00 Anchor (10:00-14:00)"
    elif current_hour >= 10:
        return 6, "10:00 Anchor (06:00-10:00)"
    else:
        return 2, "06:00 Anchor (02:00-06:00)"

def find_anchor_candle(rates: list, target_start_hour: int, offset_hours: int, now_canary: datetime.datetime) -> dict:
    """Finds the H4 candle rate that matches the target anchor time criteria."""
    for rate in reversed(rates):
        rate_time = rate.get('time') if isinstance(rate, dict) else getattr(rate, 'time', None)
        if rate_time is None:
            continue
        broker_start_dt = datetime.datetime.fromtimestamp(rate_time)
        canary_start_dt = broker_start_dt - datetime.timedelta(hours=offset_hours)
        
        if canary_start_dt.hour == target_start_hour:
            # If it's overnight (h < 6), look for yesterday's 10:00 candle
            if now_canary.hour < 6:
                yesterday_date = (now_canary - datetime.timedelta(days=1)).date()
                if canary_start_dt.date() == yesterday_date:
                    return rate
            else:
                if canary_start_dt.date() == now_canary.date():
                    return rate
    # Fallback to index 1 (previous closed candle) if not found in list
    if len(rates) > 1:
        return rates[1]
    return rates[0] if rates else None

def is_in_active_killzone(time_utc: datetime.datetime, killzones: dict, config_times: dict) -> bool:
    """Checks if the given UTC datetime falls within any active sessions."""
    now_utc = time_utc.hour * 60 + time_utc.minute
    
    def parse_t(t_str):
        try:
            h, m = map(int, t_str.split(":"))
            return h * 60 + m
        except Exception:
            return 0

    windows = {}
    if killzones.get("london", False):
        windows["london"] = (parse_t(config_times.get("london_start", "07:00")), parse_t(config_times.get("london_end", "10:00")))
    if killzones.get("newyork", False):
        windows["newyork"] = (parse_t(config_times.get("new_york_start", "12:00")), parse_t(config_times.get("new_york_end", "15:00")))
    if killzones.get("asian", False):
        windows["asian"] = (parse_t(config_times.get("asian_start", "02:00")), parse_t(config_times.get("asian_end", "05:00")))
    if killzones.get("overlap", False):
        windows["overlap"] = (12*60, 15*60)

    for name, (start, end) in windows.items():
        if start <= end:
            if start <= now_utc <= end:
                return True
        else:
            if now_utc >= start or now_utc <= end:
                return True
    return False

def check_sweep(price_bid: float, price_ask: float, crt_high: float, crt_low: float) -> str:
    """Returns 'SELL' if bid sweeps high, 'BUY' if ask sweeps low, otherwise None."""
    if crt_high <= 0.0 or crt_low <= 0.0:
        return None
    if price_bid > crt_high:
        return "SELL"
    elif price_ask < crt_low:
        return "BUY"
    return None

def validate_hard_rules(
    symbol: str,
    time_canary: datetime.datetime,
    current_spread_points: float,
    range_size_pips: float,
    ltf_atr: float,
    config_rules: dict,
    bot_config: dict,
    m1_candle: dict = None
) -> tuple[bool, str]:
    """
    Validates the 5 sequential Capa 1 filters: Time, Spread, ATR, Wick-body, and Dimension.
    """
    time_str = time_canary.strftime("%H:%M")
    
    def is_time_between(t, start, end):
        if start <= end:
            return start <= t <= end
        else:
            return t >= start or t <= end

    # 1. Validate Time
    time_valid = False
    
    time_windows = {}
    kz = bot_config.get("killzones", {})
    if kz.get("london", False):
        time_windows["london"] = (bot_config.get("london_start", "07:00"), bot_config.get("london_end", "10:00"))
    if kz.get("newyork", False):
        time_windows["newyork"] = (bot_config.get("new_york_start", "12:00"), bot_config.get("new_york_end", "15:00"))
    if kz.get("asian", False):
        time_windows["asian"] = (bot_config.get("asian_start", "02:00"), bot_config.get("asian_end", "05:00"))
        
    for kz_name, (start, end) in time_windows.items():
        if start and end and is_time_between(time_str, start, end):
            time_valid = True
            break
            
    # Check Nine AM Model Cycle (if enabled)
    nam_cycle = config_rules.get("nine_am_model_cycle", {})
    if not time_valid and nam_cycle.get("enabled", False):
        for phase in ["acumulacion", "manipulacion", "distribucion"]:
            phase_range = nam_cycle.get(phase, {})
            start = phase_range.get("start")
            end = phase_range.get("end")
            if start and end and is_time_between(time_str, start, end):
                time_valid = True
                break
                
    if not time_valid:
        return False, f"Horario restringido: hora actual ({time_str}) fuera de killzones y ciclo Nine AM."

    # 2. Validate Spread
    spread_bypass = bot_config.get("disable_spread_filter", False)
    spread_max = bot_config.get("max_spread_points", 20.0)

    if spread_bypass:
        spread_ok = True
    else:
        spread_pips = current_spread_points / 10.0
        max_ratio = config_rules.get("spread_threshold", {}).get("max_spread_to_ltf_atr_ratio", 0.20)
        max_allowed_spread = max_ratio * ltf_atr
        spread_ok = (spread_pips <= max_allowed_spread) and (current_spread_points <= spread_max)
    
    if not spread_ok:
        spread_pips = current_spread_points / 10.0
        max_ratio = config_rules.get("spread_threshold", {}).get("max_spread_to_ltf_atr_ratio", 0.20)
        max_allowed_spread = max_ratio * ltf_atr
        if current_spread_points > spread_max:
            return False, f"Spread excedido: {current_spread_points:.1f} puntos (máx: {spread_max:.1f} puntos)."
        else:
            return False, f"Spread excedido: {spread_pips:.1f} pips (máx: {max_allowed_spread:.1f} pips, ratio: {max_ratio*100:.0f}% del ATR)."

    # 3. Validate ATR
    atr_bypass = bot_config.get("disable_atr_filter", False)
    atr_min = bot_config.get("min_atr_pips", 12.0)

    if atr_bypass:
        atr_ok = True
    else:
        atr_ok = ltf_atr >= atr_min

    if not atr_ok:
        return False, f"ATR insuficiente: {ltf_atr:.1f} pips (mínimo: {atr_min:.1f} pips)."

    # 4. Wick/Body Ratio
    wick_bypass = bot_config.get("disable_wick_body_filter", False)
    wick_max_ratio = bot_config.get("max_wick_body_ratio", 20.0) / 100.0

    if wick_bypass:
        wick_ok = True
    else:
        if m1_candle is not None:
            candle_range = float(m1_candle.get('high', 0.0) - m1_candle.get('low', 0.0))
            body_size = abs(float(m1_candle.get('close', 0.0) - m1_candle.get('open', 0.0)))
            if candle_range > 0:
                wick_ok = body_size <= (candle_range * wick_max_ratio)
            else:
                wick_ok = True
        else:
            wick_ok = True

    if not wick_ok:
        return False, f"Filtro Mecha CRT: el cuerpo de la vela supera el límite configurado del rango total."

    # 5. Dimension
    dim_bypass = bot_config.get("disable_dimension_filter", False)
    min_amp_forex = bot_config.get("min_amplitude_forex_pct", 0.08)
    min_amp_idx = bot_config.get("min_amplitude_indices_points", 20.0)

    if not dim_bypass:
        symbol_upper = symbol.upper()
        is_forex = any(f_sym in symbol_upper for f_sym in [
            "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
            "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"
        ])
        
        if is_forex:
            price = m1_candle.get('close', 1.08) if m1_candle else 1.08
            pip_value = 0.01 if "JPY" in symbol_upper else 0.0001
            range_price_diff = range_size_pips * pip_value
            amplitude_pct = (range_price_diff / price) * 100.0
            
            if amplitude_pct < min_amp_forex:
                return False, f"Dimensión insuficiente en Forex: {amplitude_pct:.3f}% (mínimo: {min_amp_forex}%)."
        else:
            if range_size_pips < min_amp_idx:
                return False, f"Dimensión insuficiente en Índices: {range_size_pips:.1f} puntos (mínimo: {min_amp_idx} puntos)."

    return True, ""
