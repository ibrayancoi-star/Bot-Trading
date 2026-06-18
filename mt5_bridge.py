import asyncio
import json
import logging
import sys
import MetaTrader5 as mt5
import websockets
import subprocess
import os
import datetime
import time
from zoneinfo import ZoneInfo
from context_engine import (
    initialize_vector_db, get_historical_trades_text,
    validate_market_context_async, add_trade_experience_async, migrate_to_symbol_collections,  # [CHROMA-OPT]
)
from dataclasses import dataclass, field
from typing import Dict
import threading

# [CRT-IMPL-1] Timezone unificado
import pytz as _pytz
_TZ_UTC = _pytz.timezone("UTC")
_TZ_CANARY = _pytz.timezone("Atlantic/Canary")

def _to_canary(utc_naive_dt):
    """Convierte datetime naive UTC de MT5 a hora Canaria con DST."""
    return utc_naive_dt.replace(tzinfo=_TZ_UTC).astimezone(_TZ_CANARY)

# [GAP-FIX-5] Importar módulo CRT puro para uso en fases futuras
# Las funciones inline existentes se mantienen intactas por compatibilidad.
# Las nuevas funcionalidades CRT usarán crt_logic.py exclusivamente.
# NOTA: el log se emite después de configurar el logger (ver bloque post-logger)
try:
    from crt_logic import classify_sweep_type, check_smt_divergence, calculate_dynamic_sl, calculate_crt_targets
    CRT_LOGIC_AVAILABLE = True
    _crt_logic_import_error = None
except ImportError as e:
    CRT_LOGIC_AVAILABLE = False
    _crt_logic_import_error = str(e)

_backtest_running = False


@dataclass
class BotConfig:
    strategy: str = "scalping"
    lot_size: float = 0.1
    take_profit_pips: int = 20
    stop_loss_pips: int = 15
    max_positions: int = 3
    max_daily_loss: float = 2.5
    chroma_threshold: float = 0.72
    chroma_top_k: int = 5
    killzones: Dict[str, bool] = field(default_factory=lambda: {
        "asian": False, "london": True, "overlap": True, "newyork": False
    })
    trailing_stop: bool = False
    partial_close: bool = False
    partial_close_pct: int = 50
    model_tbs_risk_multiplier: float = 1.0
    model_tws_risk_multiplier: float = 0.5
    hybrid_m1_m15_confluence: bool = True
    smt_divergence_check: bool = True

    # [CRT-IMPL-3] Nuevos campos con default conservador
    require_candle_confirmation: bool = False
    use_dynamic_sl: bool = False
    use_crt_targets: bool = False
    partial_close_at_eq: bool = False
    smt_divergence_enabled: bool = False

    # [BYPASS CAPA 1] — Killzones dinámicas
    london_start:   str   = "07:00"
    london_end:     str   = "10:00"
    new_york_start: str   = "12:00"
    new_york_end:   str   = "15:00"
    asian_start:    str   = "02:00"
    asian_end:      str   = "05:00"

    # [BYPASS CAPA 1] — Filtros con bypass
    max_spread_points:      float = 20.0
    disable_spread_filter:  bool  = False
    min_atr_pips:           float = 12.0
    disable_atr_filter:     bool  = False
    max_wick_body_ratio:    float = 20.0
    disable_wick_body_filter: bool = False

    # [BYPASS DIMENSIÓN]
    disable_dimension_filter:       bool  = False
    min_amplitude_forex_pct:        float = 0.08
    min_amplitude_indices_points:   float = 20.0

# Variable global mutable (hilo-segura)
_config_lock = threading.Lock()
bot_config = BotConfig()


# Configuración de Logs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("MT5Bridge")

# [GAP-FIX-5] Log diferido del import de crt_logic (requiere logger ya configurado)
if CRT_LOGIC_AVAILABLE:
    logger.info("[CRT] Módulo crt_logic.py cargado correctamente")
else:
    logger.warning(f"[CRT] crt_logic.py no disponible: {_crt_logic_import_error}. Usando lógica inline.")

# Mapa de temporalidades para MetaTrader 5
# IMPORTANTE: Las claves DEBEN coincidir exactamente con el tipo Timeframe del frontend (minúsculas)
TIMEFRAME_MAP = {
    "1m": mt5.TIMEFRAME_M1,
    "3m": mt5.TIMEFRAME_M3,
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "30m": mt5.TIMEFRAME_M30,
    "1h": mt5.TIMEFRAME_H1,
    "2h": mt5.TIMEFRAME_H2,
    "4h": mt5.TIMEFRAME_H4,
    "6h": mt5.TIMEFRAME_H6,
    "8h": mt5.TIMEFRAME_H8,
    "12h": mt5.TIMEFRAME_H12,
    "1d": mt5.TIMEFRAME_D1,
    "1w": mt5.TIMEFRAME_W1,
    "1M": mt5.TIMEFRAME_MN1,
}

# Estado de Conexiones
CONNECTED_CLIENTS = set()
MT5_INITIALIZED = False

# Active Timeframe (sincronizada desde la UI del frontend)
active_timeframe = "1m"

# Risk Guard State
RISK_GUARD_TRIGGERED = False
daily_starting_balance = None
daily_starting_date = None
risk_config = {
    "max_daily_loss_pct": 4.5,
    "max_total_loss_pct": 8.0
}

# Bot Active State (sincronizado con la interfaz web)
BOT_ACTIVE = False
ACTIVE_BOT_SYMBOLS = ["EURUSD", "GBPUSD"]

# Últimos ticks conocidos para evitar envíos redundantes
last_ticks = {
    "EURUSD": {"bid": 0.0, "ask": 0.0},
    "GBPUSD": {"bid": 0.0, "ask": 0.0}
}

# Rangos de referencia anclados para EURUSD y GBPUSD
anchor_ranges = {
    "EURUSD": {"high": 0.0, "low": 0.0, "eq": 0.0, "anchor_time": "Ninguno", "candle_type": "H4", "bias": "NEUTRO"},
    "GBPUSD": {"high": 0.0, "low": 0.0, "eq": 0.0, "anchor_time": "Ninguno", "candle_type": "H4", "bias": "NEUTRO"}
}

# [RANGE-TOL] Tolerancia de ruptura por cierre, por par (en pips). Un cierre solo invalida
# el rango si supera high+tol o low-tol. Fuente: verify_range_logic.py / check_ranges.py
_H4_TOLERANCE_PIPS = {"EURUSD": 2.5, "GBPUSD": 3.0}

# [CRT-IMPL-3] Buffer de confirmacion de sweep por cierre de vela
_sweep_pending: dict = {}

# [CRT-IMPL-4] EQ targets y control de cierre parcial
_crt_eq_target: dict = {}
_eq_done: set = set()

# Registro de la última acción del escáner para evitar spamming en los logs y WS
last_scanner_action_time = {
    "EURUSD": {"DETECTED": 0, "DISMISSED": 0},
    "GBPUSD": {"DETECTED": 0, "DISMISSED": 0}
}

def calculate_ema(prices, period):
    if len(prices) < period:
        return 0.0
    k = 2 / (period + 1)
    ema_val = sum(prices[:period]) / period
    for price in prices[period:]:
        ema_val = price * k + ema_val * (1 - k)
    return ema_val

def calculate_rsi(prices, period=14):
    if len(prices) <= period:
        return 50.0
    gains = []
    losses = []
    for i in range(1, period + 1):
        diff = prices[i] - prices[i-1]
        if diff >= 0:
            gains.append(diff)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(-diff)
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    for i in range(period + 1, len(prices)):
        diff = prices[i] - prices[i-1]
        g = diff if diff > 0 else 0.0
        l = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))

def calculate_macd(prices, fast=12, slow=26, signal=9):
    if len(prices) < slow + signal:
        return 0.0, 0.0, 0.0
    k_fast = 2 / (fast + 1)
    k_slow = 2 / (slow + 1)
    
    ema_fast = sum(prices[:fast]) / fast
    ema_fast_list = [ema_fast]
    for p in prices[fast:]:
        ema_fast = p * k_fast + ema_fast * (1 - k_fast)
        ema_fast_list.append(ema_fast)
        
    ema_slow = sum(prices[:slow]) / slow
    ema_slow_list = [ema_slow]
    for p in prices[slow:]:
        ema_slow = p * k_slow + ema_slow * (1 - k_slow)
        ema_slow_list.append(ema_slow)
        
    macd_line = []
    for i in range(len(ema_slow_list)):
        f = ema_fast_list[slow - fast + i]
        s = ema_slow_list[i]
        macd_line.append(f - s)
        
    if len(macd_line) < signal:
        return 0.0, 0.0, 0.0
    k_sig = 2 / (signal + 1)
    sig_val = sum(macd_line[:signal]) / signal
    for val in macd_line[signal:]:
        sig_val = val * k_sig + sig_val * (1 - k_sig)
        
    macd_val = macd_line[-1]
    hist_val = macd_val - sig_val
    return macd_val, sig_val, hist_val

def get_indicators(broker_sym, mt5_tf):
    # Solicitamos suficientes velas para que los indicadores (EMA 21, MACD 26, RSI 14) se calculen con precisión
    rates = mt5.copy_rates_from_pos(broker_sym, mt5_tf, 0, 150)
    if rates is None or len(rates) < 50:
        return {
            "ema_9": 0.0,
            "ema_21": 0.0,
            "rsi": 50.0,
            "macd": {"macd": 0.0, "signal": 0.0, "histogram": 0.0}
        }
    prices = [float(r['close']) for r in rates]
    ema_9 = calculate_ema(prices, 9)
    ema_21 = calculate_ema(prices, 21)
    rsi_val = calculate_rsi(prices, 14)
    macd_val, sig_val, hist_val = calculate_macd(prices, 12, 26, 9)
    return {
        "ema_9": ema_9,
        "ema_21": ema_21,
        "rsi": rsi_val,
        "macd": {
            "macd": macd_val,
            "signal": sig_val,
            "histogram": hist_val
        }
    }

# Cache de resolución de símbolos del bróker
_symbol_cache = {}

def get_broker_symbol(symbol: str) -> str:
    """Busca el nombre del símbolo admitido por el bróker (p. ej. resolviendo sufijos tipo EURUSD.ecn)."""
    if symbol in _symbol_cache:
        return _symbol_cache[symbol]
    try:
        info = mt5.symbol_info(symbol)
        if info is not None:
            _symbol_cache[symbol] = symbol
            return symbol
        symbols = mt5.symbols_get()
        if symbols:
            for s in symbols:
                if s.name.upper().startswith(symbol.upper()):
                    _symbol_cache[symbol] = s.name
                    logger.info(f"MT5: Símbolo '{symbol}' resuelto como '{s.name}' en el bróker.")
                    return s.name
    except Exception as e:
        logger.error(f"Error al resolver el símbolo del bróker para {symbol}: {e}")
    _symbol_cache[symbol] = symbol
    return symbol

def is_mt5_running():
    """Comprueba mediante tasklist si la terminal de MT5 se está ejecutando."""
    try:
        output = subprocess.check_output('tasklist', shell=True).decode('utf-8', errors='ignore')
        return 'terminal64.exe' in output.lower() or 'terminal.exe' in output.lower()
    except Exception:
        return False

def is_algo_trading_enabled():
    """Verifica si el Algo Trading está habilitado en la terminal MT5."""
    try:
        ti = mt5.terminal_info()
        if ti is not None:
            return ti.trade_allowed
    except Exception:
        pass
    return False

def validate_hard_rules(symbol: str, current_spread_points: float, range_size_pips: float, ltf_atr: float) -> tuple[bool, str]:
    """
    Carga config_crt.json, obtiene la hora localizada en Atlantic/Canary,
    valida killzones/horarios, comprueba el spread vs ATR (max 20%),
    y verifica dimensiones según tipo de activo (Forex: 0.08% de amplitud, Índices: 20 puntos).
    """
    try:
        config_path = "config_crt.json"
        if not os.path.exists(config_path):
            return False, f"Archivo de configuración '{config_path}' no encontrado."
            
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
            
        rules = config.get("capa_1_hard_rules", {})
        
        # Obtener hora actual en la zona horaria indicada (ej. Atlantic/Canary)
        tz_name = rules.get("timezone", "Atlantic/Canary")
        tz = ZoneInfo(tz_name)
        now_local = datetime.datetime.now(tz)
        time_str = now_local.strftime("%H:%M")
        
        def is_time_between(t, start, end):
            if start <= end:
                return start <= t <= end
            else:
                return t >= start or t <= end
                
        # 1. Validar el Horario (Killzones o Nine AM Model Cycle)
        time_valid = False
        
        # [BYPASS CAPA 1] — Horarios de Killzones dinámicas
        with _config_lock:
            time_windows = {}
            kz = bot_config.killzones
            if kz.get("london", False):
                time_windows["london"]   = (bot_config.london_start,   bot_config.london_end)
            if kz.get("newyork", False):
                time_windows["newyork"]  = (bot_config.new_york_start, bot_config.new_york_end)
            if kz.get("asian", False):
                time_windows["asian"]    = (bot_config.asian_start,    bot_config.asian_end)
                
        # Verificar Killzones
        for kz_name, (start, end) in time_windows.items():
            if start and end and is_time_between(time_str, start, end):
                time_valid = True
                break
                
        # Verificar Nine AM Model Cycle (si está habilitado)
        nam_cycle = rules.get("nine_am_model_cycle", {})
        if not time_valid and nam_cycle.get("enabled", False):
            for phase in ["acumulacion", "manipulacion", "distribucion"]:
                phase_range = nam_cycle.get(phase, {})
                start = phase_range.get("start")
                end = phase_range.get("end")
                if start and end and is_time_between(time_str, start, end):
                    time_valid = True
                    break
                    
        if not time_valid:
            return False, f"Horario restringido: hora actual ({time_str} en {tz_name}) fuera de killzones y ciclo Nine AM."
            
        # 2. Validar el Spread
        # [BYPASS CAPA 1] — Spread
        with _config_lock:
            spread_bypass = bot_config.disable_spread_filter
            spread_max    = bot_config.max_spread_points

        if spread_bypass:
            spread_ok = True
        else:
            spread_pips = current_spread_points / 10.0
            max_ratio = rules.get("spread_threshold", {}).get("max_spread_to_ltf_atr_ratio", 0.20)
            max_allowed_spread = max_ratio * ltf_atr
            spread_ok = (spread_pips <= max_allowed_spread) and (current_spread_points <= spread_max)
        
        if not spread_ok:
            spread_pips = current_spread_points / 10.0
            max_ratio = rules.get("spread_threshold", {}).get("max_spread_to_ltf_atr_ratio", 0.20)
            max_allowed_spread = max_ratio * ltf_atr
            if current_spread_points > spread_max:
                return False, f"Spread excedido: {current_spread_points:.1f} puntos (máx: {spread_max:.1f} puntos)."
            else:
                return False, f"Spread excedido: {spread_pips:.1f} pips (máx: {max_allowed_spread:.1f} pips, ratio: {max_ratio*100:.0f}% del ATR)."
            
        # [BYPASS CAPA 1] — ATR
        with _config_lock:
            atr_bypass = bot_config.disable_atr_filter
            atr_min    = bot_config.min_atr_pips

        if atr_bypass:
            atr_ok = True
        else:
            atr_value = ltf_atr
            atr_ok    = atr_value >= atr_min

        if not atr_ok:
            return False, f"ATR insuficiente: {ltf_atr:.1f} pips (mínimo: {atr_min:.1f} pips)."

        # [BYPASS CAPA 1] — Ratio mecha CRT
        with _config_lock:
            wick_bypass    = bot_config.disable_wick_body_filter
            wick_max_ratio = bot_config.max_wick_body_ratio / 100.0  # convertir % a decimal

        if wick_bypass:
            wick_ok = True
        else:
            # Obtener la última vela M1 para validar el ratio cuerpo/mecha
            rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1)
            if rates is not None and len(rates) > 0:
                candle = rates[0]
                candle_range = float(candle['high'] - candle['low'])
                body_size = abs(float(candle['close'] - candle['open']))
                if candle_range > 0:
                    wick_ok = body_size <= (candle_range * wick_max_ratio)
                else:
                    wick_ok = True
            else:
                wick_ok = True

        if not wick_ok:
            return False, f"Filtro Mecha CRT: el cuerpo de la vela supera el límite configurado del rango total."

        # 3. Validar Dimensión
        # [BYPASS DIMENSIÓN] — leer config dinámica en un solo bloque
        with _config_lock:
            dim_bypass    = bot_config.disable_dimension_filter
            min_amp_forex = bot_config.min_amplitude_forex_pct
            min_amp_idx   = bot_config.min_amplitude_indices_points

        # Aplicar bypass o validación dinámica
        if dim_bypass:
            # [BYPASS DIMENSIÓN] usuario desactivó el filtro — pasar directamente
            pass
        else:
            symbol_upper = symbol.upper()
            
            # Clasificar Forex vs Indices
            is_forex = any(f_sym in symbol_upper for f_sym in [
                "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
                "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"
            ])
            
            if is_forex:
                # Consultar precio actual en MT5 para calcular porcentaje
                tick = mt5.symbol_info_tick(symbol)
                price = tick.bid if tick else 1.08  # fallback
                
                # Convertir range_size_pips a diferencia de precio
                pip_value = 0.01 if "JPY" in symbol_upper else 0.0001
                range_price_diff = range_size_pips * pip_value
                amplitude_pct = (range_price_diff / price) * 100.0
                
                if amplitude_pct < min_amp_forex:
                    return False, f"Dimensión insuficiente en Forex: {amplitude_pct:.3f}% (mínimo: {min_amp_forex}%)."
            else:
                if range_size_pips < min_amp_idx:
                    return False, f"Dimensión insuficiente en Índices: {range_size_pips:.1f} puntos (mínimo: {min_amp_idx} puntos)."
                    
        return True, ""
    except Exception as e:
        logger.error(f"Error en validación de hard rules: {e}")
        return False, f"Error interno en validación: {str(e)}"

def get_current_atr(broker_sym, timeframe, period=14):
    """
    Calcula el Average True Range (ATR) en pips o puntos en base a los últimos 'period' candles.
    """
    try:
        rates = mt5.copy_rates_from_pos(broker_sym, timeframe, 0, period + 1)
        if rates is None or len(rates) < period + 1:
            return 12.0  # safe default in pips
        
        tr_sum = 0.0
        for i in range(1, len(rates)):
            h = float(rates[i]['high'])
            l = float(rates[i]['low'])
            pc = float(rates[i-1]['close'])
            tr = max(h - l, abs(h - pc), abs(l - pc))
            tr_sum += tr
            
        atr_value = tr_sum / period
        
        # Convertir a pips
        symbol_upper = broker_sym.upper()
        pip_value = 0.01 if "JPY" in symbol_upper else 0.0001
        return atr_value / pip_value
    except Exception as e:
        logger.error(f"Error al calcular ATR para {broker_sym}: {e}")
        return 12.0

def _h4_range_broken(cand_high: float, cand_low: float, later, tol: float) -> bool:
    """
    Determina si una vela candidata fue invalidada por velas posteriores.
    Reglas (port de verify_range_logic.py):
    1. Ruptura por cierre FUERA de tolerancia: close > high+tol  ó  close < low-tol.
    2. RANGO AGOTADO: una vela posterior toma ambos extremos, o se toma un extremo y
       luego (en otra vela) el opuesto. Usa mechas (high/low) para "tomar" un extremo.
    `later` incluye las cerradas siguientes Y la vela en formación.
    """
    low_taken = False
    high_taken = False
    for c in later:
        close = float(c["close"])
        if close > cand_high + tol:
            return True
        if close < cand_low - tol:
            return True

        took_low = float(c["low"]) <= cand_low
        took_high = float(c["high"]) >= cand_high

        if took_low and took_high:
            return True
        if low_taken and took_high:
            return True
        if high_taken and took_low:
            return True

        if took_low:
            low_taken = True
        if took_high:
            high_taken = True
    return False


def _compute_range_bias(ref_high: float, ref_low: float, after, current_bid: float) -> str:
    """
    Bias direccional de un rango (port de verify_range_logic.py):
    high tomado -> SELL (esperamos reversión bajista), low tomado -> BUY.
    Gana el último extremo tomado; el precio actual tiene la última palabra.
    `after` debe incluir las velas posteriores al rango Y la vela en formación.
    """
    bias = "NEUTRO"
    for c in after:
        if float(c["high"]) >= ref_high:
            bias = "SELL"
        if float(c["low"]) <= ref_low:
            bias = "BUY"
    if current_bid >= ref_high:
        bias = "SELL"
    if current_bid <= ref_low:
        bias = "BUY"
    return bias


def update_reference_ranges():
    """
    Selecciona la vela H4 de anclaje (CRT range candle) = la última vela cerrada cuyo
    rango NO fue roto, aplicando tolerancia por par y la regla de rango agotado.

    Regla (port fiel de verify_range_logic.py / check_ranges.py):
    1. La vela en formación NO es candidata, pero SÍ evalúa (puede romper/agotar).
    2. Invalidación por cierre solo si supera high+tol / low-tol (tolerancia por par).
    3. Invalidación por rango agotado: velas posteriores tomaron ambos extremos.
    4. Se elige la MÁS RECIENTE cerrada no rota (escaneo nuevo->viejo).
    Además calcula el BIAS direccional y lo difunde a la web.
    """
    global MT5_INITIALIZED, anchor_ranges
    if not MT5_INITIALIZED:
        return

    try:
        for symbol in ["EURUSD", "GBPUSD"]:
            broker_sym = get_broker_symbol(symbol)

            rates_h4 = mt5.copy_rates_from_pos(broker_sym, mt5.TIMEFRAME_H4, 0, 60)
            if rates_h4 is None or len(rates_h4) < 3:
                continue

            tick = mt5.symbol_info_tick(broker_sym)
            if tick is None:
                continue
            current_bid = tick.bid

            pip_value = 0.01 if "JPY" in symbol.upper() else 0.0001
            tol = _H4_TOLERANCE_PIPS.get(symbol, 2.5) * pip_value

            forming = rates_h4[-1]          # en formación: evalúa pero no es candidata
            closed = rates_h4[:-1]          # solo cerradas son candidatas

            reference = None
            # Escanear de la MÁS RECIENTE cerrada hacia atrás: la primera no rota es el rango.
            for i in range(len(closed) - 1, -1, -1):
                cand = closed[i]
                later = list(closed[i + 1:]) + [forming]
                if not _h4_range_broken(float(cand["high"]), float(cand["low"]), later, tol):
                    reference = cand
                    break

            # Fallback: ninguna válida -> usar la última cerrada
            if reference is None:
                reference = closed[-1]

            high = float(reference["high"])
            low = float(reference["low"])
            eq = low + 0.5 * (high - low)
            candle_dt = datetime.datetime.utcfromtimestamp(int(reference["time"]))
            anchor_label = f"H4 {candle_dt.strftime('%d/%m %H:%M')} UTC"

            # Bias: velas posteriores al rango (cerradas + en formación) y precio actual
            ref_time = int(reference["time"])
            after = [c for c in rates_h4 if int(c["time"]) > ref_time]
            bias = _compute_range_bias(high, low, after, current_bid)

            prev = anchor_ranges[symbol]
            if prev["high"] != high or prev["low"] != low or prev.get("bias") != bias:
                anchor_ranges[symbol].update({
                    "high": high,
                    "low": low,
                    "eq": eq,
                    "anchor_time": anchor_label,
                    "bias": bias,
                })
                logger.info(f"[H4-ANCHOR] {symbol} | bid={current_bid:.5f} | ✅ {anchor_label} H={high:.5f} L={low:.5f} EQ={eq:.5f} BIAS={bias}")

                asyncio.create_task(broadcast({
                    "type": "anchor_update",
                    "symbol": symbol,
                    "high": high,
                    "low": low,
                    "eq": eq,
                    "anchor_time": anchor_label,
                    "bias": bias,
                }))
                asyncio.create_task(emit_daily_range(None))
    except Exception as e:
        logger.error(f"Error en update_reference_ranges: {e}")

# [CHART-VISUAL-1] Emitir rango de vela diaria para dibujo en gráfico
async def emit_daily_range(target):
    """
    Última vela D1 cerrada que cumple DOS condiciones:
    1. Su rango (wick high/low) contiene el precio actual
    2. Su rango no fue superado por el CUERPO de velas cerradas posteriores
    La vela en formación NO participa como evaluadora ni como candidata.
    """
    bot_active_symbols = ACTIVE_BOT_SYMBOLS
    for symbol in bot_active_symbols:
        broker_sym = get_broker_symbol(symbol)

        # Solo velas CERRADAS (start_pos=1 salta la en formación)
        rates_d1 = mt5.copy_rates_from_pos(broker_sym, mt5.TIMEFRAME_D1, 1, 15)
        if rates_d1 is None or len(rates_d1) < 2:
            continue

        # Obtener precio actual para verificar contención
        tick = mt5.symbol_info_tick(broker_sym)
        if tick is None:
            continue
        current_bid = tick.bid

        from datetime import datetime
        reference = None

        logger.info(f"[D1-RANGE] === {symbol} | bid={current_bid:.5f} | {len(rates_d1)} velas cerradas ===")

        for i in range(len(rates_d1) - 1, -1, -1):
            wick_high = float(rates_d1[i]["high"])
            wick_low = float(rates_d1[i]["low"])
            candle_date = datetime.fromtimestamp(int(rates_d1[i]["time"])).strftime("%d/%m")

            # Condición 1: el precio actual debe estar DENTRO del rango
            if current_bid > wick_high or current_bid < wick_low:
                logger.info(f"[D1-RANGE] {candle_date} | H={wick_high:.5f} L={wick_low:.5f} | ⏭️ Precio fuera del rango")
                continue

            # Condición 2: ninguna vela CERRADA posterior superó con cuerpo
            superado = False
            rota_por = ""
            for j in range(i + 1, len(rates_d1)):
                body_top = max(float(rates_d1[j]["open"]), float(rates_d1[j]["close"]))
                body_bot = min(float(rates_d1[j]["open"]), float(rates_d1[j]["close"]))
                breaker_date = datetime.fromtimestamp(int(rates_d1[j]["time"])).strftime("%d/%m")

                if body_top > wick_high:
                    superado = True
                    rota_por = f"HIGH roto por {breaker_date} (body={body_top:.5f} > high={wick_high:.5f})"
                    break
                if body_bot < wick_low:
                    superado = True
                    rota_por = f"LOW roto por {breaker_date} (body={body_bot:.5f} < low={wick_low:.5f})"
                    break

            if superado:
                logger.info(f"[D1-RANGE] {candle_date} | H={wick_high:.5f} L={wick_low:.5f} | ❌ {rota_por}")
            else:
                logger.info(f"[D1-RANGE] {candle_date} | H={wick_high:.5f} L={wick_low:.5f} | ✅ VÁLIDA")
                reference = rates_d1[i]
                logger.info(f"[D1-RANGE] → REFERENCIA: {candle_date}")
                break

        if reference is None:
            reference = rates_d1[-1]
            fallback_date = datetime.fromtimestamp(int(reference["time"])).strftime("%d/%m")
            logger.info(f"[D1-RANGE] → FALLBACK: {fallback_date}")

        # [BIAS-D1] Bias direccional sobre el rango D1. Incluye la vela D1 en formación
        # para detectar el barrido aunque el precio ya haya vuelto dentro del rango.
        ref_high_d1 = float(reference["high"])
        ref_low_d1 = float(reference["low"])
        ref_time_d1 = int(reference["time"])
        after_d1 = [c for c in rates_d1 if int(c["time"]) > ref_time_d1]
        forming_d1 = mt5.copy_rates_from_pos(broker_sym, mt5.TIMEFRAME_D1, 0, 1)
        if forming_d1 is not None and len(forming_d1) > 0:
            after_d1 = list(after_d1) + [forming_d1[0]]
        bias_d1 = _compute_range_bias(ref_high_d1, ref_low_d1, after_d1, current_bid)
        logger.info(f"[D1-RANGE] {symbol} → BIAS: {bias_d1}")

        msg = {
            "type": "daily_range",
            "symbol": symbol,
            "high": round(float(reference["high"]), 5),
            "low": round(float(reference["low"]), 5),
            "open": round(float(reference["open"]), 5),
            "close": round(float(reference["close"]), 5),
            "time": int(reference["time"]),
            "bias": bias_d1
        }

        if hasattr(target, 'send'):
            await target.send(json.dumps(msg))
        else:
            await broadcast(msg)
            
def is_in_active_killzone() -> bool:
    """Retorna True si la hora UTC actual está dentro de alguna killzone activa."""
    # [CRT-IMPL-1] Timezone unificado
    now_canary = _to_canary(datetime.datetime.utcnow())
    now_utc = now_canary.hour * 60 + now_canary.minute
    with _config_lock:
        kz = bot_config.killzones
        london_start = bot_config.london_start
        london_end = bot_config.london_end
        new_york_start = bot_config.new_york_start
        new_york_end = bot_config.new_york_end
        asian_start = bot_config.asian_start
        asian_end = bot_config.asian_end

    def parse_t(t_str):
        try:
            h, m = map(int, t_str.split(":"))
            return h * 60 + m
        except Exception:
            return 0

    windows = {}
    if kz.get("london", False):
        windows["london"] = (parse_t(london_start), parse_t(london_end))
    if kz.get("newyork", False):
        windows["newyork"] = (parse_t(new_york_start), parse_t(new_york_end))
    if kz.get("asian", False):
        windows["asian"] = (parse_t(asian_start), parse_t(asian_end))
    if kz.get("overlap", False):
        windows["overlap"] = (12*60, 15*60)

    for name, (start, end) in windows.items():
        if start <= end:
            if start <= now_utc <= end:
                return True
        else:
            if now_utc >= start or now_utc <= end:
                return True
    return False

def get_active_killzone_name() -> str:
    """Retorna el nombre de la killzone activa o 'none'. [HISTORY-FIX-2]"""
    now_canary = _to_canary(datetime.datetime.utcnow())
    now_min = now_canary.hour * 60 + now_canary.minute
    with _config_lock:
        kz = bot_config.killzones
        windows = {}
        def parse_t(t):
            try:
                h, m = map(int, t.split(":")); return h * 60 + m
            except Exception:
                return 0
        if kz.get("london",   False): windows["london"]   = (parse_t(bot_config.london_start),   parse_t(bot_config.london_end))
        if kz.get("newyork",  False): windows["newyork"]  = (parse_t(bot_config.new_york_start),  parse_t(bot_config.new_york_end))
        if kz.get("asian",    False): windows["asian"]    = (parse_t(bot_config.asian_start),     parse_t(bot_config.asian_end))
        if kz.get("overlap",  False): windows["overlap"]  = (12 * 60, 15 * 60)
    for name, (start, end) in windows.items():
        if (start <= end and start <= now_min <= end) or (start > end and (now_min >= start or now_min <= end)):
            return name
    return "none"


def _build_crt_comment(sweep_type, sweep_confidence) -> str:
    """Construye comment enriquecido para órdenes del bot (máx 31 chars MT5). [HISTORY-FIX-2]"""
    parts = ["CRT"]
    if sweep_type:
        parts.append(f"sweep:{sweep_type}")
    if sweep_confidence is not None:
        parts.append(f"conf:{sweep_confidence:.2f}")
    parts.append(f"kz:{get_active_killzone_name()}")
    return "|".join(parts)[:31]


async def strategy_scanner_task():
    """
    Bucle en segundo plano que monitorea en tiempo real barridos de liquidez (Sweeps)
    y ejecuta operaciones autónomas con el motor de reglas (Capa 1 y Capa 2/3).
    """
    global MT5_INITIALIZED, RISK_GUARD_TRIGGERED, anchor_ranges, last_scanner_action_time
    logger.info("Escáner de Estrategia: Iniciando bucle autónomo...")
    
    # Cooldown para evitar abrir múltiples posiciones consecutivas en la misma vela
    last_trade_time = {
        "EURUSD": 0.0,
        "GBPUSD": 0.0
    }

    # Inicializar rangos
    await asyncio.sleep(5)
    update_reference_ranges()

    while True:
        if _backtest_running:
            await asyncio.sleep(1)
            continue
        if MT5_INITIALIZED and not RISK_GUARD_TRIGGERED:
            try:
                # Actualizar rangos periódicamente
                update_reference_ranges()
                
                # [GAP-FIX-3] Verificar límite total de posiciones abiertas
                if bot_config.max_positions > 0:
                    all_positions = mt5.positions_get()
                    total_open = len(all_positions) if all_positions else 0
                    if total_open >= bot_config.max_positions:
                        await asyncio.sleep(1.0)
                        continue

                if not BOT_ACTIVE:
                    await asyncio.sleep(1.0)
                    continue
                
                if not is_in_active_killzone():
                    await asyncio.sleep(1.0)
                    continue
                
                for symbol in ACTIVE_BOT_SYMBOLS:
                    broker_sym = get_broker_symbol(symbol)
                    
                    # Evitar duplicar si ya hay una posición abierta para el par
                    positions = mt5.positions_get(symbol=broker_sym)
                    if positions is not None and len(positions) > 0:
                        continue
                        
                    # Respetar cooldown de 3 minutos tras ejecutar una orden autónoma
                    now_time = time.time()
                    if now_time - last_trade_time[symbol] < 180:
                        continue

                    # Obtener precios y datos del símbolo
                    tick = mt5.symbol_info_tick(broker_sym)
                    sym_info = mt5.symbol_info(broker_sym)
                    if tick is None or sym_info is None or sym_info.point <= 0:
                        continue

                    bid = tick.bid
                    ask = tick.ask
                    
                    crt_high = anchor_ranges[symbol]["high"]
                    crt_low = anchor_ranges[symbol]["low"]
                    
                    if crt_high == 0.0 or crt_low == 0.0:
                        continue # No hay velas de anclaje inicializadas aún

                    # [CRT-IMPL-3] Procesar confirmación de sweep pendiente si existe
                    if symbol in _sweep_pending and bot_config.require_candle_confirmation:
                        pendiente = _sweep_pending[symbol]
                        elapsed = (datetime.datetime.utcnow() - pendiente["timestamp"]).total_seconds()
                        if elapsed > 180:
                            logger.info(f"[CRT] {symbol} sweep timeout - descartado")
                            del _sweep_pending[symbol]
                            continue
                        rates_m1 = mt5.copy_rates_from_pos(broker_sym, mt5.TIMEFRAME_M1, 0, 2)
                        if rates_m1 is None or len(rates_m1) < 2:
                            continue
                        vela_3_candidate = {"open": float(rates_m1[0]["open"]), "high": float(rates_m1[0]["high"]), "low": float(rates_m1[0]["low"]), "close": float(rates_m1[0]["close"]), "time": rates_m1[0]["time"]}
                        if vela_3_candidate["time"] <= pendiente["vela_2"]["time"]:
                            continue
                        resultado = classify_sweep_type(pendiente["vela_2"], vela_3_candidate, pendiente["crt_high"], pendiente["crt_low"], pendiente["direction"])
                        if resultado["type"] == "INVALID":
                            logger.info(f"[CRT] {symbol} Vela 3 no confirmo - sweep descartado")
                            del _sweep_pending[symbol]
                            continue
                        direction = pendiente["direction"]
                        sweep_type = resultado["type"]
                        sweep_confidence = resultado["confidence"]
                        sweep_vela_2 = pendiente["vela_2"]
                        del _sweep_pending[symbol]
                        logger.info(f"[CRT] {symbol} sweep CONFIRMADO: {sweep_type} (confianza {sweep_confidence:.2f})")
                        
                        price = tick.bid if direction == "SELL" else tick.ask
                    else:
                        sweep_type = None
                        sweep_confidence = None
                        sweep_vela_2 = None

                        # Detección de Barrido (Sweep)
                        direction = None
                        price = 0.0
                        
                        if bid > crt_high:
                            direction = "SELL"
                            price = bid
                        elif ask < crt_low:
                            direction = "BUY"
                            price = ask
                        
                        if direction is not None:
                            # Evitar spamming de la señal DETECTED (máximo una vez cada 60 segundos por dirección)
                            last_det_time = last_scanner_action_time[symbol]["DETECTED"]
                            if now_time - last_det_time > 60:
                                last_scanner_action_time[symbol]["DETECTED"] = now_time
                                await broadcast({
                                    "type": "scanner_signal",
                                    "symbol": symbol,
                                    "action": "DETECTED",
                                    "direction": direction,
                                    "price": price,
                                    "message": f"⚠️ Señal de barrido detectada en {symbol} ({direction} @ {price:.5f}). Evaluando filtros..."
                                })
                                logger.info(f"Escáner: Señal de barrido detectada en {symbol} ({direction} @ {price:.5f}). Evaluando filtros...")

                            # [CRT-IMPL-3] Registrar pendiente si require_candle_confirmation está activo
                            if bot_config.require_candle_confirmation and CRT_LOGIC_AVAILABLE:
                                if symbol not in _sweep_pending:
                                    rates_m1 = mt5.copy_rates_from_pos(broker_sym, mt5.TIMEFRAME_M1, 0, 2)
                                    if rates_m1 is not None and len(rates_m1) >= 2:
                                        vela_2 = {"open": float(rates_m1[0]["open"]), "high": float(rates_m1[0]["high"]), "low": float(rates_m1[0]["low"]), "close": float(rates_m1[0]["close"]), "time": rates_m1[0]["time"]}
                                        _sweep_pending[symbol] = {"direction": direction, "vela_2": vela_2, "crt_high": crt_high, "crt_low": crt_low, "timestamp": datetime.datetime.utcnow()}
                                        logger.info(f"[CRT] {symbol} sweep pendiente de confirmacion ({direction}) - esperando Vela 3")
                                continue

                    if direction is not None:
                        # Evitar spamming de la señal DETECTED (máximo una vez cada 60 segundos por dirección)
                        last_det_time = last_scanner_action_time[symbol]["DETECTED"]
                        if now_time - last_det_time > 60:
                            last_scanner_action_time[symbol]["DETECTED"] = now_time
                            await broadcast({
                                "type": "scanner_signal",
                                "symbol": symbol,
                                "action": "DETECTED",
                                "direction": direction,
                                "price": price,
                                "message": f"⚠️ Señal de barrido detectada en {symbol} ({direction} @ {price:.5f}). Evaluando filtros..."
                            })
                            logger.info(f"Escáner: Señal de barrido detectada en {symbol} ({direction} @ {price:.5f}). Evaluando filtros...")

                        # Parámetros cuantitativos
                        current_spread_points = float((tick.ask - tick.bid) / sym_info.point)
                        ltf_atr = get_current_atr(broker_sym, mt5.TIMEFRAME_M1, 14)
                        
                        symbol_upper = symbol.upper()
                        pip_value = 0.01 if "JPY" in symbol_upper else 0.0001
                        range_size_pips = (crt_high - crt_low) / pip_value

                        # --- CAPA 1: VALIDACIÓN DE HARD RULES ---
                        hard_ok, hard_msg = validate_hard_rules(broker_sym, current_spread_points, range_size_pips, ltf_atr)
                        if not hard_ok:
                            # Evitar spamming de desestimación
                            last_dism_time = last_scanner_action_time[symbol]["DISMISSED"]
                            if now_time - last_dism_time > 60:
                                last_scanner_action_time[symbol]["DISMISSED"] = now_time
                                await broadcast({
                                    "type": "scanner_signal",
                                    "symbol": symbol,
                                    "action": "DISMISSED",
                                    "direction": direction,
                                    "reason": f"Capa 1: {hard_msg}",
                                    "message": f"❌ Señal desestimada en {symbol}: {hard_msg}"
                                })
                                logger.info(f"Escáner: Señal desestimada en {symbol}: {hard_msg}")
                            continue

                        # [CRT-IMPL-3] Filtro SMT Divergence
                        if bot_config.smt_divergence_enabled and CRT_LOGIC_AVAILABLE:
                            correlated_sym = "GBPUSD" if symbol == "EURUSD" else "EURUSD"
                            corr_ranges = anchor_ranges.get(correlated_sym, {})
                            corr_tick = mt5.symbol_info_tick(correlated_sym)
                            if corr_ranges and corr_tick:
                                corr_bid = corr_tick.bid
                                corr_ask = corr_tick.ask
                                corr_high = corr_ranges.get("high", 0)
                                corr_low = corr_ranges.get("low", 0)
                                if direction == "SELL":
                                    primary_swept = bid > crt_high
                                    correlated_swept = corr_bid > corr_high
                                else:
                                    primary_swept = ask < crt_low
                                    correlated_swept = corr_ask < corr_low
                                has_divergence = check_smt_divergence(primary_swept, correlated_swept)
                                if not has_divergence:
                                    logger.info(f"[CRT] SMT: ambos pares barrieron - sin divergencia, descartado")
                                    await broadcast({"type": "scanner_signal", "symbol": symbol, "action": "DISMISSED", "direction": direction, "reason": "SMT: sin divergencia institucional"})
                                    continue
                                logger.info(f"[CRT] SMT: divergencia confirmada - {symbol} barrio, {correlated_sym} no")

                        # --- CONTEXTO DE MERCADO (CHROMA-OPT-3: informativo) ---
                        # Obtener parámetros dinámicos del bot de manera segura para hilos
                        with _config_lock:
                            lot = bot_config.lot_size
                            tp_pips = bot_config.take_profit_pips
                            sl_pips = bot_config.stop_loss_pips
                            threshold = bot_config.chroma_threshold
                            top_k = bot_config.chroma_top_k

                        # [CHROMA-OPT-3] ChromaDB es solo INFORMATIVO — nunca bloquea ni toca el lote.
                        # [CHROMA-OPT-4] Llamada no bloqueante (hilo secundario).
                        active_kz = get_active_killzone_name()
                        try:
                            context_result = await validate_market_context_async(
                                symbol, direction, sweep_type, active_kz, threshold, top_k
                            )
                            chroma_context = context_result.get("context", "NEW")
                        except Exception as e:
                            chroma_context = "NEW"
                            logger.warning(f"[CHROMA] Error en contexto (se continúa): {e}")
                        logger.info(f"[CHROMA] Contexto: {chroma_context}")

                        # El resultado se incluye en el scanner_signal para visibilidad (no detiene la señal)
                        await broadcast({
                            "type": "scanner_signal",
                            "symbol": symbol,
                            "action": "DETECTED",
                            "direction": direction,
                            "chroma_context": chroma_context,
                            "message": f"Señal {direction} en {symbol} · Contexto ChromaDB: {chroma_context}",
                        })

                        # --- SEÑAL CONFIRMADA: DISPARO AUTÓNOMO (ChromaDB no la detiene) ---
                        # Calcular SL y TP usando los pips dinámicos configurados
                        if direction == "SELL":
                            sl_price = price + sl_pips * pip_value
                            tp_price = price - tp_pips * pip_value
                            order_type = mt5.ORDER_TYPE_SELL
                        else:
                            sl_price = price - sl_pips * pip_value
                            tp_price = price + tp_pips * pip_value
                            order_type = mt5.ORDER_TYPE_BUY

                        # [CRT-IMPL-3] SL dinamico basado en mecha de vela_2
                        if bot_config.use_dynamic_sl and sweep_vela_2 and CRT_LOGIC_AVAILABLE:
                            sl_price_calc = calculate_dynamic_sl(sweep_vela_2, direction, pip_value, buffer_pips=1.5)
                            if direction == "BUY" and sl_price_calc < price:
                                sl_price = sl_price_calc
                                logger.info(f"[CRT] SL dinamico aplicado: {sl_price:.5f}")
                            elif direction == "SELL" and sl_price_calc > price:
                                sl_price = sl_price_calc
                                logger.info(f"[CRT] SL dinamico aplicado: {sl_price:.5f}")

                        # [CRT-IMPL-3] TP1 en EQ, TP2 en extremo opuesto
                        if bot_config.use_crt_targets and CRT_LOGIC_AVAILABLE:
                            targets = calculate_crt_targets(crt_high, crt_low, direction)
                            tp_price = targets["tp2"]
                            _crt_eq_target[symbol] = targets["tp1"]
                            logger.info(f"[CRT] Targets: EQ={targets['eq']:.5f} TP1={targets['tp1']:.5f} TP2={targets['tp2']:.5f}")

                        volume = lot  # Lotaje controlado desde el frontend

                        # [CRT-IMPL-3] Multiplicador TBS/TWS al lotaje
                        if sweep_type and CRT_LOGIC_AVAILABLE:
                            multiplier = bot_config.model_tbs_risk_multiplier if sweep_type == "TBS" else bot_config.model_tws_risk_multiplier
                            volume = round(volume * multiplier, 2)
                            volume = max(volume, 0.01)
                            logger.info(f"[CRT] Lotaje ajustado por {sweep_type}: {volume} (x{multiplier})")
                        
                        request = {
                            "action": mt5.TRADE_ACTION_DEAL,
                            "symbol": broker_sym,
                            "volume": volume,
                            "type": order_type,
                            "price": price,
                            "sl": sl_price,
                            "tp": tp_price,
                            "deviation": 20,
                            "magic": 234000,
                            "comment": _build_crt_comment(sweep_type, sweep_confidence),  # [HISTORY-FIX-2]
                            "type_time": mt5.ORDER_TIME_GTC,
                        }

                        # Enviar orden usando fallbacks de filling mode
                        result = try_order_send(request)
                        
                        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
                            last_trade_time[symbol] = now_time
                            msg = f"🚀 ¡Operación ejecutada automáticamente! {direction} {symbol} @ {price:.5f}. SL: {sl_price:.5f}, TP: {tp_price:.5f}. Ticket: {result.order}"
                            logger.info(f"Escáner: {msg}")
                            await broadcast({
                                "type": "scanner_signal",
                                "symbol": symbol,
                                "action": "EXECUTED",
                                "direction": direction,
                                "ticket": result.order,
                                "price": price,
                                "sl": sl_price,
                                "tp": tp_price,
                                "message": msg
                            })
                        else:
                            comment = result.comment if result else "Error desconocido"
                            msg = f"❌ Falló ejecución automática en {symbol}: {comment}"
                            logger.error(f"Escáner: {msg}")
                            await broadcast({
                                "type": "scanner_signal",
                                "symbol": symbol,
                                "action": "FAILED",
                                "direction": direction,
                                "reason": comment,
                                "message": msg
                            })

            except Exception as e:
                logger.error(f"Error en strategy_scanner_task: {e}", exc_info=True)
                
        await asyncio.sleep(1.0)  # Escaneo a frecuencia de 1Hz para óptimo rendimiento asíncrono

async def check_mt5_connection():
    """Bucle que intenta inicializar y mantener la conexión con MT5, sin forzar su apertura."""
    global MT5_INITIALIZED
    while True:
        if not MT5_INITIALIZED:
            if not is_mt5_running():
                logger.debug("MT5: La terminal no esta abierta. Esperando a que el usuario la abra manualmente...")
                await asyncio.sleep(5)
                continue

            logger.info("MT5: Intentando conectar con la terminal MetaTrader 5...")
            # Inicializa MT5. Intenta conectarse a la terminal abierta por defecto.
            if mt5.initialize():
                logger.info("MT5: Conexion exitosa con MetaTrader 5!")
                # Mostrar versión de MT5
                version = mt5.version()
                logger.info(f"MT5: Version de MT5: {version}")
                
                # Verificar estado de Algo Trading
                algo = is_algo_trading_enabled()
                logger.info(f"MT5: Algo Trading habilitado: {algo}")
                if not algo:
                    logger.warning("⚠️ MT5: ALGO TRADING ESTÁ DESHABILITADO. Las órdenes desde la web NO se ejecutarán. "
                                   "Habilita 'Algo Trading' en la barra de herramientas de MT5.")
                
                # Intentar habilitar EURUSD y GBPUSD en MarketWatch
                for sym in ["EURUSD", "GBPUSD"]:
                    broker_sym = get_broker_symbol(sym)
                    selected = mt5.symbol_select(broker_sym, True)
                    if not selected:
                        logger.warning(f"MT5: No se pudo seleccionar/activar el simbolo {broker_sym} en MarketWatch")
                    else:
                        logger.info(f"MT5: Simbolo {broker_sym} activo en MarketWatch.")
                
                MT5_INITIALIZED = True
            else:
                logger.error(f"MT5: Error al inicializar MT5: {mt5.last_error()}. Asegurate de que la terminal de escritorio de MT5 este abierta.")
                MT5_INITIALIZED = False
        else:
            # Verificar si sigue conectado
            terminal_info = mt5.terminal_info()
            if terminal_info is None:
                logger.warning("MT5: Se perdio la conexion con la terminal de MT5.")
                MT5_INITIALIZED = False
                _symbol_cache.clear()
                mt5.shutdown()
        await asyncio.sleep(5)

def get_account_data():
    """Obtiene y formatea los datos de la cuenta en MT5."""
    if not MT5_INITIALIZED:
        return None
    
    acc_info = mt5.account_info()
    if acc_info is None:
        return None
    
    server_lower = acc_info.server.lower()
    trade_mode = acc_info.trade_mode
    
    # Palabras clave comunes de servidores de empresas de fondeo (Prop Firms)
    prop_keywords = [
        "ftmo", "funding", "funded", "prop", "ttp", "challenge", "evaluation", 
        "funder", "e8", "tff", "myforexfunds", "mff", "fundingpips", "smartprop"
    ]
    
    is_prop = any(kw in server_lower for kw in prop_keywords)
    
    if is_prop:
        account_type = "fondeo"
    elif trade_mode == 2:
        account_type = "real"
    else:
        account_type = "demo"
    
    algo_trading = is_algo_trading_enabled()
    
    return {
        "type": "account",
        "balance": acc_info.balance,
        "equity": acc_info.equity,
        "profit": acc_info.profit,
        "margin": acc_info.margin,
        "margin_free": acc_info.margin_free,
        "leverage": acc_info.leverage,
        "currency": acc_info.currency,
        "server": acc_info.server,
        "login": acc_info.login,
        "trade_mode": acc_info.trade_mode,
        "account_type": account_type,
        "algo_trading": algo_trading,
        "status": "connected"
    }

async def positions_broadcaster():
    """Bucle que consulta y transmite las posiciones abiertas actuales."""
    # [CRT-IMPL-4-FIX] Declarar globales usadas en el cierre parcial
    global MT5_INITIALIZED, _eq_done, _crt_eq_target
    while True:
        if MT5_INITIALIZED:
            try:
                positions = mt5.positions_get()
                if positions is not None:
                    # [CRT-IMPL-4] Cierre parcial en EQ
                    if bot_config.partial_close_at_eq and CRT_LOGIC_AVAILABLE:
                        for pos in positions:
                            ticket = pos.ticket
                            sym = pos.symbol
                            eq_price = _crt_eq_target.get(sym)
                            if not eq_price or ticket in _eq_done:
                                continue
                            current = pos.price_current
                            hit_eq = (pos.type == 0 and current >= eq_price) or (pos.type == 1 and current <= eq_price)
                            if hit_eq:
                                vol_cerrar = round(pos.volume * (bot_config.partial_close_pct / 100), 2)
                                if vol_cerrar >= 0.01:
                                    close_req = mt5.order_send({
                                        "action": mt5.TRADE_ACTION_DEAL,
                                        "symbol": sym,
                                        "volume": vol_cerrar,
                                        "type": mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY,
                                        "position": ticket,
                                        "price": mt5.symbol_info_tick(sym).bid if pos.type == 0 else mt5.symbol_info_tick(sym).ask,
                                        "comment": "CRT_EQ_PARTIAL"
                                    })
                                    if close_req and close_req.retcode == mt5.TRADE_RETCODE_DONE:
                                        mt5.order_send({"action": mt5.TRADE_ACTION_SLTP, "position": ticket, "sl": pos.price_open, "tp": pos.tp})
                                        _eq_done.add(ticket)
                                        logger.info(f"[CRT] {sym} cierre parcial en EQ: {vol_cerrar} lotes, SL a breakeven")
                        open_tickets = {p.ticket for p in positions}
                        _eq_done &= open_tickets

                    pos_list = []
                    for p in positions:
                        pos_list.append({
                            "ticket": p.ticket,
                            "symbol": p.symbol,
                            "type": "buy" if p.type == mt5.ORDER_TYPE_BUY else "sell",
                            "volume": p.volume,
                            "open_price": p.price_open,
                            "current_price": p.price_current,
                            "sl": p.sl,
                            "tp": p.tp,
                            "profit": p.profit,
                            "time": p.time
                        })
                    await broadcast({
                        "type": "positions",
                        "data": pos_list
                    })
            except Exception as e:
                logger.error(f"MT5: Error en positions_broadcaster: {e}")
        await asyncio.sleep(1) # Refrescar posiciones cada segundo

async def broadcast(message_dict):
    """Envía un mensaje JSON a todos los clientes conectados."""
    if not CONNECTED_CLIENTS:
        return
    
    message_str = json.dumps(message_dict)
    inactive_clients = set()
    
    for client in CONNECTED_CLIENTS:
        try:
            await client.send(message_str)
        except websockets.exceptions.ConnectionClosed:
            inactive_clients.add(client)
        except Exception as e:
            logger.error(f"Error al enviar mensaje a cliente: {e}")
            inactive_clients.add(client)
            
    if inactive_clients:
        CONNECTED_CLIENTS.difference_update(inactive_clients)

async def send_to_client(websocket, message_dict):
    """Envía un mensaje JSON a un cliente específico."""
    try:
        await websocket.send(json.dumps(message_dict))
    except Exception as e:
        logger.error(f"Error al enviar mensaje a cliente específico: {e}")

def try_order_send(request):
    """Intenta enviar una orden a MT5 probando múltiples modos de filling."""
    filling_modes = [
        mt5.ORDER_FILLING_IOC,
        mt5.ORDER_FILLING_FOK,
        mt5.ORDER_FILLING_RETURN
    ]
    
    result = None
    for mode in filling_modes:
        request["type_filling"] = mode
        result = mt5.order_send(request)
        if result is not None and result.retcode == mt5.TRADE_RETCODE_DONE:
            return result
        
        retcode = result.retcode if result else "None"
        comment = result.comment if result else "No result"
        logger.warning(f"MT5: Filling mode {mode} rechazado ({retcode}: {comment}), probando otro...")
    
    return result

def panic_close_all_positions():
    """Cierra todas las posiciones abiertas a precio de mercado en situación de pánico."""
    logger.error("🚨 RISK GUARD: Ejecutando cierre de pánico de todas las posiciones.")
    positions = mt5.positions_get()
    if positions is None or len(positions) == 0:
        logger.info("Risk Guard: No hay posiciones abiertas para cerrar.")
        return
        
    for p in positions:
        ticket = p.ticket
        symbol = p.symbol
        volume = p.volume
        
        # Tipo de orden opuesto para cerrar
        order_type = mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
        
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            logger.error(f"Risk Guard: No se pudo obtener tick para {symbol}, saltando cierre.")
            continue
            
        price = tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask
        
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "position": ticket,
            "price": price,
            "deviation": 20,
            "magic": 234000,
            "comment": "Panic Close RiskGuard",
            "type_time": mt5.ORDER_TIME_GTC,
        }
        
        result = try_order_send(request)
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            logger.info(f"Risk Guard: Posición {ticket} cerrada exitosamente.")
        else:
            logger.error(f"Risk Guard: Error al cerrar posición {ticket}: {result.comment if result else 'Error desconocido'}")

async def tick_broadcaster():
    """Bucle de alta frecuencia para consultar y transmitir ticks de EURUSD y GBPUSD, y evaluar Risk Guard."""
    global MT5_INITIALIZED, RISK_GUARD_TRIGGERED, daily_starting_balance, daily_starting_date
    _risk_guard_logged = False
    while True:
        if MT5_INITIALIZED:
            # === RISK GUARD LOGIC ===
            if not RISK_GUARD_TRIGGERED:
                acc_info = mt5.account_info()
                if acc_info is not None:
                    now_date = datetime.datetime.now().date()
                    
                    # Inicializar balance diario si es el primer inicio o cambió de día
                    if daily_starting_balance is None or daily_starting_date != now_date:
                        daily_starting_balance = acc_info.balance
                        daily_starting_date = now_date
                        logger.info(f"Risk Guard: Balance diario inicializado a {daily_starting_balance} para la fecha {now_date}")
                        
                    current_equity = acc_info.equity
                    current_loss = daily_starting_balance - current_equity
                    
                    # [GAP-FIX-2] Usar max_daily_loss de BotConfig si está definido (> 0),
                    # fallback a config_crt.json para compatibilidad con sesiones sin UI.
                    effective_daily_loss_pct = (
                        bot_config.max_daily_loss
                        if bot_config.max_daily_loss > 0
                        else risk_config.get("max_daily_loss_pct", 4.5)
                    )
                    
                    effective_total_loss_pct = (
                        bot_config.max_daily_loss * 2  # convención: total = 2x diario
                        if bot_config.max_daily_loss > 0
                        else risk_config.get("max_total_loss_pct", 8.0)
                    )
                    
                    if not _risk_guard_logged:
                        logger.info(f"[RISK GUARD] Límites efectivos: diario={effective_daily_loss_pct}% "
                                    f"total={effective_total_loss_pct}% (fuente: {'UI' if bot_config.max_daily_loss > 0 else 'config_crt.json'})")
                        _risk_guard_logged = True
                        
                    max_daily_loss = daily_starting_balance * (effective_daily_loss_pct / 100.0)
                    max_total_loss = daily_starting_balance * (effective_total_loss_pct / 100.0)
                    
                    if current_loss >= max_daily_loss or current_loss >= max_total_loss:
                        RISK_GUARD_TRIGGERED = True
                        logger.error(f"🚨 RISK GUARD ACTIVADO 🚨 Drawdown actual: {current_loss:.2f} supera el límite.")
                        
                        # Ejecutar cierre en hilo no bloqueante para no frenar el WS
                        loop = asyncio.get_running_loop()
                        await loop.run_in_executor(None, panic_close_all_positions)
                        
                        # Transmitir alerta de bloqueo al frontend
                        await broadcast({
                            "type": "risk_guard_alert",
                            "message": f"🚨 DRAWDOWN SUPERADO. Operativa bloqueada. Pérdida flotante: {current_loss:.2f}."
                        })
            # ========================

            for symbol in ["EURUSD", "GBPUSD"]:
                broker_sym = get_broker_symbol(symbol)
                tick = mt5.symbol_info_tick(broker_sym)
                if tick is not None:
                    bid = tick.bid
                    ask = tick.ask
                    
                    # Solo transmitir si el precio cambió
                    if bid != last_ticks[symbol]["bid"] or ask != last_ticks[symbol]["ask"]:
                        last_ticks[symbol]["bid"] = bid
                        last_ticks[symbol]["ask"] = ask
                        
                        # Calcular indicadores en base a la temporalidad activa
                        mt5_tf = TIMEFRAME_MAP.get(active_timeframe, mt5.TIMEFRAME_M1)
                        indicators_data = get_indicators(broker_sym, mt5_tf)
                        
                        await broadcast({
                            "type": "tick",
                            "symbol": symbol,
                            "bid": bid,
                            "ask": ask,
                            "time": tick.time,
                            "indicators": indicators_data
                        })
                else:
                    logger.debug(f"No se pudo obtener el tick para {symbol}")
        await asyncio.sleep(0.1) # 100ms interval (frecuencia de 10Hz)

async def account_broadcaster():
    """Bucle para transmitir métricas de cuenta periódicamente (cada 1s)."""
    while True:
        if MT5_INITIALIZED:
            data = get_account_data()
            if data:
                await broadcast(data)
        await asyncio.sleep(1.0)

async def run_backtest(params, websocket):
    global _backtest_running
    _backtest_running = True
    try:
        symbol = params.get("symbol", "EURUSD")
        timeframe = params.get("timeframe", "1m")
        from_date_str = params.get("from")
        to_date_str = params.get("to")
        config = params.get("config", {})
        
        # Convert dates
        date_from = datetime.datetime.strptime(from_date_str, "%Y-%m-%d")
        date_to = datetime.datetime.strptime(to_date_str, "%Y-%m-%d")
        
        from backtesting_engine import DataLayer, SimEngine
        
        # Preflight Check
        df = DataLayer.get_historical_data(symbol, timeframe, date_from, date_to)
        h4_from = date_from - datetime.timedelta(days=5)
        h4_df = DataLayer.get_historical_data(symbol, "4h", h4_from, date_to)
        
        async def ws_send_fn(msg):
            await send_to_client(websocket, msg)
            
        def is_running_check_fn():
            return _backtest_running
            
        await SimEngine.run(df, h4_df, symbol, config, ws_send_fn, is_running_check_fn)
    except Exception as e:
        logger.exception("Error en backtest")
        await send_to_client(websocket, {
            "type": "backtest_error",
            "message": str(e)
        })
    finally:
        _backtest_running = False

# [HISTORY-FIX-1] Envía historial real de MT5 (últimos N días) a un cliente.
async def send_trade_history(websocket, days_back: int = 30):
    """Envía history_full con trades cerrados reales de MT5 + métricas agregadas."""
    if not MT5_INITIALIZED:
        return
    try:
        date_from = datetime.datetime.now() - datetime.timedelta(days=days_back)
        date_to   = datetime.datetime.now()
        deals = mt5.history_deals_get(date_from, date_to)
        if deals is None:
            return

        closed_deals = [d for d in deals if d.entry in (1, 2)]
        history = []
        for d in closed_deals:
            open_deals = [od for od in deals if od.position_id == d.position_id and od.entry == 0]
            open_deal  = open_deals[0] if open_deals else None

            open_price = open_deal.price if open_deal else 0.0
            open_time  = datetime.datetime.fromtimestamp(open_deal.time).isoformat() if open_deal else ""
            close_time = datetime.datetime.fromtimestamp(d.time).isoformat()
            duration_s = int(d.time - open_deal.time) if open_deal else 0

            comment_str = d.comment or ""
            if comment_str.startswith("CRT") or "scanner" in comment_str.lower():
                origin = "bot_partial" if "CRT_EQ_PARTIAL" in comment_str else "bot"
            else:
                origin = "manual"

            sym_info  = mt5.symbol_info(d.symbol)
            point     = sym_info.point if sym_info else 0.00001
            pip_value = point * 10
            pips = 0.0
            if open_price > 0 and pip_value > 0:
                if d.type == mt5.DEAL_TYPE_SELL:
                    pips = round((d.price - open_price) / pip_value, 1)
                else:
                    pips = round((open_price - d.price) / pip_value, 1)

            # [HISTORY-FIX-2] Parsear métricas CRT del comment
            crt_meta: dict = {}
            if comment_str.startswith("CRT"):
                for part in comment_str.split("|")[1:]:
                    if ":" in part:
                        k, v = part.split(":", 1)
                        crt_meta[k] = v

            trade: dict = {
                "ticket":      d.position_id,
                "symbol":      d.symbol,
                "direction":   "BUY" if (open_deal and open_deal.type == mt5.DEAL_TYPE_BUY) else "SELL",
                "volume":      round(d.volume, 2),
                "open_price":  round(open_price, 5),
                "close_price": round(d.price, 5),
                "open_time":   open_time,
                "close_time":  close_time,
                "duration_s":  duration_s,
                "profit":      round(d.profit, 2),
                "pips":        pips,
                "commission":  round(d.commission, 2),
                "swap":        round(d.swap, 2),
                "net_profit":  round(d.profit + d.commission + d.swap, 2),
                "origin":      origin,
                "comment":     comment_str,
                "sl":          0.0,
                "tp":          0.0,
                "crt_meta":    crt_meta,
            }
            orders = mt5.history_orders_get(position=d.position_id)
            if orders:
                for o in orders:
                    if o.sl > 0: trade["sl"] = round(o.sl, 5)
                    if o.tp > 0: trade["tp"] = round(o.tp, 5)
            history.append(trade)

        history.sort(key=lambda x: x["close_time"], reverse=True)

        # [HISTORY-FIX-2] Métricas agregadas
        total    = len(history)
        wins     = [t for t in history if t["profit"] > 0]
        losses   = [t for t in history if t["profit"] < 0]
        bots     = [t for t in history if t["origin"] in ("bot", "bot_partial")]
        manuals  = [t for t in history if t["origin"] == "manual"]
        t_profit = sum(t["net_profit"] for t in history)
        t_pips   = sum(t["pips"]       for t in history)
        avg_dur  = sum(t["duration_s"] for t in history) / total if total else 0
        wr       = len(wins) / total * 100 if total else 0
        avg_w    = sum(t["net_profit"] for t in wins)   / len(wins)   if wins   else 0
        avg_l    = sum(t["net_profit"] for t in losses) / len(losses) if losses else 0
        l_sum    = sum(t["net_profit"] for t in losses)
        pf       = abs(sum(t["net_profit"] for t in wins) / l_sum) if l_sum != 0 else 0
        max_dd   = min((t["net_profit"] for t in history), default=0)
        tbs = [t for t in history if t.get("crt_meta", {}).get("sweep") == "TBS"]
        tws = [t for t in history if t.get("crt_meta", {}).get("sweep") == "TWS"]
        tbs_wr = len([t for t in tbs if t["profit"] > 0]) / len(tbs) * 100 if tbs else 0
        tws_wr = len([t for t in tws if t["profit"] > 0]) / len(tws) * 100 if tws else 0

        metrics = {
            "total":          total,
            "wins":           len(wins),
            "losses":         len(losses),
            "win_rate":       round(wr,      1),
            "total_profit":   round(t_profit, 2),
            "total_pips":     round(t_pips,   1),
            "avg_win":        round(avg_w,    2),
            "avg_loss":       round(avg_l,    2),
            "profit_factor":  round(pf,       2),
            "avg_duration_s": round(avg_dur),
            "max_dd_trade":   round(max_dd,   2),
            "bot_trades":     len(bots),
            "manual_trades":  len(manuals),
            "tbs_count":      len(tbs),
            "tbs_wr":         round(tbs_wr, 1),
            "tws_count":      len(tws),
            "tws_wr":         round(tws_wr, 1),
        }

        await websocket.send(json.dumps({
            "type":    "history_full",
            "trades":  history,
            "metrics": metrics,
        }))
        logger.info(f"[HISTORY] Enviado history_full: {total} trades a {websocket.remote_address}")
    except Exception as e:
        logger.error(f"[HISTORY] Error en send_trade_history: {e}")


async def handler(websocket):
    """Manejador de conexiones WebSocket entrantes."""
    global BOT_ACTIVE, ACTIVE_BOT_SYMBOLS
    logger.info(f"WS: Nuevo cliente conectado desde {websocket.remote_address}")
    CONNECTED_CLIENTS.add(websocket)
    
    # Enviar estado inicial
    await websocket.send(json.dumps({
        "type": "bot_status",
        "active": BOT_ACTIVE,
        "symbols": ACTIVE_BOT_SYMBOLS
    }))
    
    if MT5_INITIALIZED:
        acc_data = get_account_data()
        if acc_data:
            await websocket.send(json.dumps(acc_data))
        
        # Enviar últimos ticks conocidos
        for symbol in ["EURUSD", "GBPUSD"]:
            if last_ticks[symbol]["bid"] > 0:
                await websocket.send(json.dumps({
                    "type": "tick",
                    "symbol": symbol,
                    "bid": last_ticks[symbol]["bid"],
                    "ask": last_ticks[symbol]["ask"],
                    "time": 0
                }))
    else:
        # Enviar estado de desconectado del broker
        await websocket.send(json.dumps({
            "type": "account",
            "status": "disconnected",
            "balance": 0,
            "equity": 0,
            "algo_trading": False
        }))

    # Enviar historial de operaciones guardadas (UI de Historial Extendida)
    try:
        loop = asyncio.get_running_loop()
        historical_trades = await loop.run_in_executor(None, get_historical_trades_text)
        await websocket.send(json.dumps({
            "type": "history_init",
            "trades": historical_trades
        }))
        
        # Enviar rangos de anclaje iniciales para pintar líneas en el gráfico
        for symbol in ["EURUSD", "GBPUSD"]:
            if anchor_ranges[symbol]["high"] > 0:
                await websocket.send(json.dumps({
                    "type": "anchor_update",
                    "symbol": symbol,
                    "high": anchor_ranges[symbol]["high"],
                    "low": anchor_ranges[symbol]["low"],
                    "eq": anchor_ranges[symbol]["eq"],
                    "anchor_time": anchor_ranges[symbol]["anchor_time"],
                    "bias": anchor_ranges[symbol].get("bias", "NEUTRO")
                }))
        await emit_daily_range(websocket)
    except Exception as e:
        logger.error(f"Error al enviar history_init al cliente: {e}")

    # [HISTORY-FIX-1] Enviar historial real de MT5 al conectar
    try:
        await send_trade_history(websocket)
    except Exception as e:
        logger.error(f"Error al enviar history_full al cliente: {e}")

    try:
        async for message in websocket:
            # Procesar posibles comandos enviados por el cliente web
            try:
                data = json.loads(message)
                logger.info(f"WS: Mensaje recibido del cliente: {data}")
                
                if data.get("type") == "backtest_start":
                    asyncio.create_task(run_backtest(data.get("params", {}), websocket))
                elif data.get("type") == "backtest_stop":
                    _backtest_running = False
                
                action = data.get("action")
                if action == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
                
                elif action == "request_history":
                    symbol = data.get("symbol", "EURUSD")
                    tf_str = data.get("timeframe", "1m")
                    global active_timeframe
                    active_timeframe = tf_str
                        
                    mt5_tf = TIMEFRAME_MAP.get(tf_str, mt5.TIMEFRAME_M1)
                    logger.info(f"WS: Solicitando historial de velas para {symbol} ({tf_str})")
                    
                    if not MT5_INITIALIZED:
                        logger.warning("WS: Intento de copiar rates pero MT5 no está inicializado.")
                        await send_to_client(websocket, {
                            "type": "history",
                            "symbol": symbol,
                            "timeframe": tf_str,
                            "data": []
                        })
                        continue
                    
                    broker_symbol = get_broker_symbol(symbol)
                    # Obtener las últimas 1000 velas para evitar timeouts o fallos de caché en MT5
                    rates = mt5.copy_rates_from_pos(broker_symbol, mt5_tf, 0, 1000)
                    
                    if rates is None or len(rates) == 0:
                        logger.error(f"MT5: Error al copiar rates para {broker_symbol}: {mt5.last_error()}")
                        await send_to_client(websocket, {
                            "type": "history",
                            "symbol": symbol,
                            "timeframe": tf_str,
                            "data": []
                        })
                    else:
                        candle_list = []
                        for rate in rates:
                            candle_list.append({
                                "time": int(rate['time']), # UNIX timestamp en segundos
                                "open": float(rate['open']),
                                "high": float(rate['high']),
                                "low": float(rate['low']),
                                "close": float(rate['close']),
                                "volume": int(rate['tick_volume']),
                                "isFinal": True
                            })
                        
                        logger.info(f"MT5: Enviado historial ({len(candle_list)} velas) para {broker_symbol} ({tf_str})")
                        await send_to_client(websocket, {
                            "type": "history",
                            "symbol": symbol,
                            "timeframe": tf_str,
                            "data": candle_list
                        })
                
                elif action == "toggle_bot":
                    BOT_ACTIVE = data.get("active", False)
                    ACTIVE_BOT_SYMBOLS = data.get("symbols", ["EURUSD", "GBPUSD"])
                    logger.info(f"WS: Bot Active status updated to: {BOT_ACTIVE}, Symbols: {ACTIVE_BOT_SYMBOLS}")
                    await broadcast({
                        "type": "bot_status",
                        "active": BOT_ACTIVE,
                        "symbols": ACTIVE_BOT_SYMBOLS
                    })
                
                elif action == "BOT_CONFIG_UPDATE" or data.get("type") == "BOT_CONFIG_UPDATE":
                    payload = data.get("payload", {})
                    with _config_lock:
                        bot_config.strategy          = payload.get("strategy", bot_config.strategy)
                        bot_config.lot_size          = float(payload.get("lotSize", bot_config.lot_size))
                        bot_config.take_profit_pips  = int(payload.get("takeProfitPips", bot_config.take_profit_pips))
                        bot_config.stop_loss_pips    = int(payload.get("stopLossPips", bot_config.stop_loss_pips))
                        bot_config.max_positions     = int(payload.get("maxPositions", bot_config.max_positions))
                        bot_config.max_daily_loss    = float(payload.get("maxDailyLoss", bot_config.max_daily_loss))
                        bot_config.chroma_threshold  = float(payload.get("chromaThreshold", bot_config.chroma_threshold))
                        bot_config.chroma_top_k      = int(payload.get("chromaTopK", bot_config.chroma_top_k))
                        bot_config.killzones         = payload.get("killzones", bot_config.killzones)
                        bot_config.trailing_stop     = bool(payload.get("trailingStop", bot_config.trailing_stop))
                        bot_config.partial_close     = bool(payload.get("partialClose", bot_config.partial_close))
                        bot_config.partial_close_pct = int(payload.get("partialClosePct", bot_config.partial_close_pct))
                        bot_config.model_tbs_risk_multiplier = float(payload.get("modelTbsRiskMultiplier", bot_config.model_tbs_risk_multiplier))
                        bot_config.model_tws_risk_multiplier = float(payload.get("modelTwsRiskMultiplier", bot_config.model_tws_risk_multiplier))
                        bot_config.hybrid_m1_m15_confluence = bool(payload.get("hybridM1M15Confluence", bot_config.hybrid_m1_m15_confluence))
                        bot_config.smt_divergence_check = bool(payload.get("smtDivergenceCheck", bot_config.smt_divergence_check))
                        
                        # [CRT-IMPL-3] WS update para nuevos parámetros
                        bot_config.require_candle_confirmation = bool(payload.get("requireCandleConfirmation", bot_config.require_candle_confirmation))
                        bot_config.use_dynamic_sl = bool(payload.get("useDynamicSl", bot_config.use_dynamic_sl))
                        bot_config.use_crt_targets = bool(payload.get("useCrtTargets", bot_config.use_crt_targets))
                        bot_config.partial_close_at_eq = bool(payload.get("partialCloseAtEq", bot_config.partial_close_at_eq))
                        bot_config.smt_divergence_enabled = bool(payload.get("smtDivergenceEnabled", bot_config.smt_divergence_enabled))

                        # [BYPASS CAPA 1] — Killzones dinámicas
                        bot_config.london_start   = payload.get("londonStart",   bot_config.london_start)
                        bot_config.london_end     = payload.get("londonEnd",     bot_config.london_end)
                        bot_config.new_york_start = payload.get("newYorkStart",  bot_config.new_york_start)
                        bot_config.new_york_end   = payload.get("newYorkEnd",    bot_config.new_york_end)
                        bot_config.asian_start    = payload.get("asianStart",    bot_config.asian_start)
                        bot_config.asian_end      = payload.get("asianEnd",      bot_config.asian_end)

                        # [BYPASS CAPA 1] — Filtros con bypass
                        bot_config.max_spread_points       = float(payload.get("maxSpreadPoints",       bot_config.max_spread_points))
                        bot_config.disable_spread_filter   = bool(payload.get("disableSpreadFilter",    bot_config.disable_spread_filter))
                        bot_config.min_atr_pips            = float(payload.get("minAtrPips",            bot_config.min_atr_pips))
                        bot_config.disable_atr_filter      = bool(payload.get("disableAtrFilter",       bot_config.disable_atr_filter))
                        bot_config.max_wick_body_ratio     = float(payload.get("maxWickBodyRatio",      bot_config.max_wick_body_ratio))
                        bot_config.disable_wick_body_filter = bool(payload.get("disableWickBodyFilter", bot_config.disable_wick_body_filter))

                        # [BYPASS DIMENSIÓN]
                        bot_config.disable_dimension_filter     = bool(payload.get("disableDimensionFilter",    bot_config.disable_dimension_filter))
                        bot_config.min_amplitude_forex_pct      = float(payload.get("minAmplitudeForexPct",     bot_config.min_amplitude_forex_pct))
                        bot_config.min_amplitude_indices_points = float(payload.get("minAmplitudeIndicesPoints",bot_config.min_amplitude_indices_points))
                    logger.info(f"[BRIDGE] Config actualizada → estrategia: {bot_config.strategy}, lote: {bot_config.lot_size}, disable_atr_filter: {bot_config.disable_atr_filter}")
                
                elif action in ["buy", "sell"]:
                    symbol = data.get("symbol", "EURUSD")
                    volume = float(data.get("volume", 0.1))
                    sl = float(data.get("sl", 0.0))
                    tp = float(data.get("tp", 0.0))
                    
                    if not MT5_INITIALIZED:
                        logger.warning("WS: Intento de orden pero MT5 no está inicializado.")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": action,
                            "error": "MT5 no está conectado."
                        })
                        continue
                    
                    if RISK_GUARD_TRIGGERED:
                        logger.error("MT5: Orden bloqueada por RISK GUARD (Drawdown excedido).")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": action,
                            "error": "Operativa bloqueada: Drawdown máximo excedido (Risk Guard)."
                        })
                        continue
                    
                    # Verificar Algo Trading
                    if not is_algo_trading_enabled():
                        logger.error("MT5: Algo Trading deshabilitado. No se puede enviar la orden.")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": action,
                            "error": "Algo Trading deshabilitado en MT5. Actívalo en la barra de herramientas."
                        })
                        continue
                    
                    broker_symbol = get_broker_symbol(symbol)
                    order_type = mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL
                    
                    tick = mt5.symbol_info_tick(broker_symbol)
                    if tick is None:
                        logger.error(f"MT5: No se pudo obtener el tick para {broker_symbol}.")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": action,
                            "error": f"No se pudo obtener precio para {broker_symbol}."
                        })
                        continue
                    
                    # Calcular spread en puntos
                    sym_info = mt5.symbol_info(broker_symbol)
                    current_spread_points = 0.0
                    if sym_info is not None and sym_info.point > 0:
                        current_spread_points = float((tick.ask - tick.bid) / sym_info.point)
                        
                    # Extraer parámetros opcionales del cliente o usar fallbacks por defecto
                    range_size_pips = float(data.get("range_size_pips", 10.0))
                    ltf_atr = float(data.get("ltf_atr", 12.0))

                    # --- CAPA 1: VALIDACIÓN DE HARD RULES ---
                    hard_ok, hard_msg = validate_hard_rules(broker_symbol, current_spread_points, range_size_pips, ltf_atr)
                    if not hard_ok:
                        error_msg = f"Rechazo Capa 1: {hard_msg}"
                        logger.warning(f"MT5: Orden cancelada por CAPA 1 (Hard Rules): {hard_msg}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": action,
                            "error": error_msg
                        })
                        continue
                        
                    # --- CONTEXTO DE MERCADO (CHROMA-OPT-3: solo informativo, no bloquea) ---
                    with _config_lock:
                        threshold = bot_config.chroma_threshold
                        top_k = bot_config.chroma_top_k

                    try:
                        context_result = await validate_market_context_async(
                            symbol, action.upper(), None, get_active_killzone_name(), threshold, top_k
                        )
                        logger.info(f"[CHROMA] Contexto (orden manual {symbol}): {context_result.get('context', 'NEW')}")
                    except Exception as e:
                        logger.warning(f"[CHROMA] Error en contexto (orden manual, se continúa): {e}")

                    price = tick.ask if action == "buy" else tick.bid
                    
                    request = {
                        "action": mt5.TRADE_ACTION_DEAL,
                        "symbol": broker_symbol,
                        "volume": volume,
                        "type": order_type,
                        "price": price,
                        "deviation": 20,
                        "magic": 234000,
                        "comment": "Web UI Order",
                        "type_time": mt5.ORDER_TIME_GTC,
                    }
                    
                    if sl > 0:
                        request["sl"] = sl
                    if tp > 0:
                        request["tp"] = tp
                    
                    result = try_order_send(request)

                    if result is None:
                        error_msg = f"Error crítico al enviar orden. {mt5.last_error()}"
                        logger.error(f"MT5: {error_msg}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": action,
                            "error": error_msg
                        })
                    elif result.retcode != mt5.TRADE_RETCODE_DONE:
                        error_msg = f"{result.comment} (código {result.retcode})"
                        logger.error(f"MT5: Error al enviar orden: {error_msg}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": action,
                            "error": error_msg
                        })
                    else:
                        logger.info(f"MT5: ✅ Orden {action.upper()} ejecutada. Ticket: {result.order}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": True,
                            "action": action,
                            "ticket": result.order,
                            "symbol": symbol,
                            "volume": volume,
                            "price": price,
                            "message": f"Orden {action.upper()} ejecutada. Ticket: {result.order}"
                        })
                        
                elif action == "modify_position":
                    ticket = int(data.get("ticket"))
                    sl = float(data.get("sl", 0.0))
                    tp = float(data.get("tp", 0.0))
                    
                    if not MT5_INITIALIZED:
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "modify",
                            "error": "MT5 no está conectado."
                        })
                        continue
                    
                    if not is_algo_trading_enabled():
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "modify",
                            "error": "Algo Trading deshabilitado en MT5."
                        })
                        continue
                        
                    pos = mt5.positions_get(ticket=ticket)
                    if not pos or len(pos) == 0:
                        logger.error(f"MT5: No se encontró la posición {ticket} para modificar.")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "modify",
                            "error": f"Posición {ticket} no encontrada."
                        })
                        continue
                    p = pos[0]
                    symbol = p.symbol
                    
                    request = {
                        "action": mt5.TRADE_ACTION_SLTP,
                        "position": ticket,
                        "symbol": symbol,
                        "sl": sl,
                        "tp": tp,
                    }
                    result = mt5.order_send(request)
                    if result is None:
                        error_msg = f"Error crítico al modificar SL/TP. {mt5.last_error()}"
                        logger.error(f"MT5: {error_msg}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "modify",
                            "error": error_msg
                        })
                    elif result.retcode != mt5.TRADE_RETCODE_DONE:
                        error_msg = f"{result.comment} (código {result.retcode})"
                        logger.error(f"MT5: Error al modificar SL/TP: {error_msg}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "modify",
                            "error": error_msg
                        })
                    else:
                        logger.info(f"MT5: ✅ SL/TP modificado para ticket {ticket}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": True,
                            "action": "modify",
                            "ticket": ticket,
                            "message": f"SL/TP modificado para posición {ticket}."
                        })
                        
                elif action == "close_position":
                    ticket = int(data.get("ticket"))
                    
                    if not MT5_INITIALIZED:
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "close",
                            "error": "MT5 no está conectado."
                        })
                        continue
                    
                    if not is_algo_trading_enabled():
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "close",
                            "error": "Algo Trading deshabilitado en MT5."
                        })
                        continue
                        
                    pos = mt5.positions_get(ticket=ticket)
                    if not pos or len(pos) == 0:
                        logger.error(f"MT5: No se encontró la posición {ticket} para cerrar.")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "close",
                            "error": f"Posición {ticket} no encontrada."
                        })
                        continue
                    p = pos[0]
                    symbol = p.symbol
                    volume = p.volume
                    
                    # Tipo de orden opuesto para cerrar
                    order_type = mt5.ORDER_TYPE_SELL if p.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
                    
                    tick = mt5.symbol_info_tick(symbol)
                    if tick is None:
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "close",
                            "error": f"No se pudo obtener precio para {symbol}."
                        })
                        continue
                    price = tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask
                    
                    request = {
                        "action": mt5.TRADE_ACTION_DEAL,
                        "symbol": symbol,
                        "volume": volume,
                        "type": order_type,
                        "position": ticket,
                        "price": price,
                        "deviation": 20,
                        "magic": 234000,
                        "comment": "Close Web UI",
                        "type_time": mt5.ORDER_TIME_GTC,
                    }
                    
                    result = try_order_send(request)

                    if result is None:
                        error_msg = f"Error crítico al cerrar posición. {mt5.last_error()}"
                        logger.error(f"MT5: {error_msg}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "close",
                            "error": error_msg
                        })
                    elif result.retcode != mt5.TRADE_RETCODE_DONE:
                        error_msg = f"{result.comment} (código {result.retcode})"
                        logger.error(f"MT5: Error al cerrar posición: {error_msg}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": "close",
                            "error": error_msg
                        })
                    else:
                        logger.info(f"MT5: ✅ Posición {ticket} cerrada exitosamente.")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": True,
                            "action": "close",
                            "ticket": ticket,
                            "message": f"Posición {ticket} cerrada."
                        })

            except json.JSONDecodeError:
                logger.warning(f"WS: Mensaje no decodificable recibido: {message}")
            except Exception as e:
                logger.error(f"WS: Error inesperado al procesar mensaje: {e}", exc_info=True)
                await send_to_client(websocket, {
                    "type": "trade_result",
                    "success": False,
                    "action": "unknown",
                    "error": str(e)
                })
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        logger.info(f"WS: Cliente desconectado {websocket.remote_address}")
        CONNECTED_CLIENTS.discard(websocket)

async def feedback_loop_task():
    """
    Bucle en segundo plano para monitorear posiciones cerradas en MT5
    y registrar los resultados en ChromaDB de forma asíncrona.
    """
    global MT5_INITIALIZED
    processed_deals = set()
    _history_iter = 0  # [HISTORY-FIX-1] Contador para broadcast each 30 s (6 × 5s)

    logger.info("Feedback Loop: Iniciando tarea de monitoreo en segundo plano...")
    
    while True:
        if MT5_INITIALIZED:
            try:
                # Consultar los deals de la última hora
                now = datetime.datetime.now()
                from_date = now - datetime.timedelta(hours=1)
                to_date = now + datetime.timedelta(minutes=5)
                
                deals = mt5.history_deals_get(from_date, to_date)
                if deals is not None and len(deals) > 0:
                    for deal in deals:
                        deal_ticket = deal.ticket
                        if deal_ticket in processed_deals:
                            continue
                            
                        # Verificar si representa una salida de posición
                        # DEAL_ENTRY_OUT (1) o DEAL_ENTRY_INOUT (2)
                        if deal.entry in [1, 2]:
                            symbol = deal.symbol
                            position_id = deal.position_id
                            
                            # Obtener el deal de entrada original para calcular pips y tipo
                            price_in = deal.price
                            original_type = "BUY"
                            
                            # Buscar deals correspondientes a la misma posición
                            position_deals = mt5.history_deals_get(position=position_id)
                            if position_deals:
                                for pd in position_deals:
                                    if pd.entry == 0:  # DEAL_ENTRY_IN (0)
                                        price_in = pd.price
                                        original_type = "BUY" if pd.type == 0 else "SELL" # 0 = ORDER_TYPE_BUY
                                        break
                                        
                            price_out = deal.price
                            
                            # Calcular pips_result
                            symbol_upper = symbol.upper()
                            pip_value = 0.01 if "JPY" in symbol_upper else 0.0001
                            
                            if original_type == "BUY":
                                pips_result = (price_out - price_in) / pip_value
                            else:
                                pips_result = (price_in - price_out) / pip_value
                                
                            # Determinar si es PROFIT o LOSS
                            # deal.profit incluye las comisiones y swaps en la cuenta si los hay
                            total_profit = deal.profit + deal.commission + deal.swap
                            outcome = "LOSS" if total_profit < 0 else "PROFIT"
                            
                            # Obtener spread del tick actual
                            tick = mt5.symbol_info_tick(symbol)
                            spread = 0.0
                            if tick is not None:
                                sym_info = mt5.symbol_info(symbol)
                                if sym_info is not None and sym_info.point > 0:
                                    spread = float((tick.ask - tick.bid) / sym_info.point) / 10.0
                                    
                            # Obtener setup original desde el comentario del deal,
                            # o usar "Web UI Setup" como fallback
                            setup_initial = deal.comment if (deal.comment and deal.comment.strip()) else "Web UI Setup"
                            
                            # [CHROMA-OPT-2] Parsear sweep_type / killzone del comment enriquecido (CRT|sweep:..|kz:..)
                            _sweep_t = None
                            _kz = None
                            if setup_initial and setup_initial.startswith("CRT"):
                                for _part in setup_initial.split("|")[1:]:
                                    if ":" in _part:
                                        _k, _v = _part.split(":", 1)
                                        if _k == "sweep":
                                            _sweep_t = _v
                                        elif _k == "kz":
                                            _kz = _v

                            trade_data = {
                                "symbol": symbol,
                                "type": original_type,
                                "outcome": outcome,
                                "pips_result": float(pips_result),
                                "spread": float(spread),
                                "setup_initial": setup_initial,
                                "sweep_type": _sweep_t,
                                "killzone": _kz
                            }

                            logger.info(f"Feedback Loop: Registrando trade en ChromaDB: Posición {position_id}, "
                                        f"Resultado: {outcome} ({pips_result:.1f} pips).")

                            # [CHROMA-OPT-4] Inserción no bloqueante en ChromaDB (hilo secundario)
                            new_trade = await add_trade_experience_async(trade_data)
                            
                            processed_deals.add(deal_ticket)
                            
                            if new_trade:
                                await broadcast({
                                    "type": "history_update",
                                    "trade": new_trade
                                })
                            
            except Exception as e:
                logger.error(f"Feedback Loop: Error en monitoreo de deals: {e}")
                
        # [HISTORY-FIX-1] Broadcast historial real cada 30 s
        _history_iter += 1
        if _history_iter >= 6:
            _history_iter = 0
            inactive_hist = set()
            for client in list(CONNECTED_CLIENTS):
                try:
                    await send_trade_history(client)
                except Exception:
                    inactive_hist.add(client)
            CONNECTED_CLIENTS.difference_update(inactive_hist)

        # Verificar cada 5 segundos
        await asyncio.sleep(5)

def load_risk_config():
    """Carga la configuración de Risk Guard desde config_crt.json"""
    global risk_config
    try:
        config_path = "config_crt.json"
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
                rm = config.get("risk_management", {})
                if "max_daily_loss_pct" in rm:
                    risk_config["max_daily_loss_pct"] = rm["max_daily_loss_pct"]
                if "max_total_loss_pct" in rm:
                    risk_config["max_total_loss_pct"] = rm["max_total_loss_pct"]
            logger.info(f"Risk Guard: Configuración cargada: {risk_config}")
    except Exception as e:
        logger.error(f"Risk Guard: Error al cargar configuración: {e}")

async def main():
    # Inicializar la base de datos de reglas vectorial en el arranque del bridge
    logger.info("Cargando base de datos de reglas en ChromaDB...")
    try:
        initialize_vector_db()
    except Exception as e:
        logger.error(f"Error al inicializar base de datos vectorial de reglas: {e}")

    # [CHROMA-OPT-1] Migrar experiencias de trade a colecciones por símbolo
    try:
        migrate_to_symbol_collections()
    except Exception as e:
        logger.error(f"Error en migración a colecciones por símbolo: {e}")

    load_risk_config()

    # Iniciar tareas concurrentes
    asyncio.create_task(check_mt5_connection())
    asyncio.create_task(tick_broadcaster())
    asyncio.create_task(account_broadcaster())
    asyncio.create_task(positions_broadcaster())
    asyncio.create_task(feedback_loop_task())
    asyncio.create_task(strategy_scanner_task())
    
    logger.info("WS: Levantando servidor WebSocket local en ws://127.0.0.1:8000 ...")
    async with websockets.serve(handler, "127.0.0.1", 8000):
        await asyncio.Future()  # Correr infinitamente

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("MT5: Servidor detenido por el usuario.")
        if MT5_INITIALIZED:
            mt5.shutdown()