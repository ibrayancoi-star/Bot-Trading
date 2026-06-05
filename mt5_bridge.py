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
from context_engine import initialize_vector_db, validate_market_context, add_trade_experience, get_historical_trades_text
from dataclasses import dataclass, field
from typing import Dict
import threading

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
    "EURUSD": {"high": 0.0, "low": 0.0, "eq": 0.0, "anchor_time": "Ninguno", "candle_type": "H4"},
    "GBPUSD": {"high": 0.0, "low": 0.0, "eq": 0.0, "anchor_time": "Ninguno", "candle_type": "H4"}
}

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

def update_reference_ranges():
    """
    Monitorea y calcula los rangos de referencia (HTF Anchor Candles) basados en la hora de Canarias.
    Busca la vela H4 que corresponde al último cierre de vela de anclaje (06:00, 10:00 o 14:00 Canary time).
    """
    global MT5_INITIALIZED, anchor_ranges
    if not MT5_INITIALIZED:
        return

    try:
        tz = ZoneInfo("Atlantic/Canary")
        now_canary = datetime.datetime.now(tz)
        current_hour = now_canary.hour

        # Determinar el inicio teórico de la vela de anclaje (Canary time)
        if current_hour >= 14 or current_hour < 6:
            target_start_hour = 10  # Vela de 10:00 a 14:00 Canary (cierra a las 14:00)
            anchor_label = "14:00 Anchor (10:00-14:00)"
        elif current_hour >= 10:
            target_start_hour = 6   # Vela de 06:00 a 10:00 Canary (cierra a las 10:00)
            anchor_label = "10:00 Anchor (06:00-10:00)"
        else:
            target_start_hour = 2   # Vela de 02:00 a 06:00 Canary (cierra a las 06:00)
            anchor_label = "06:00 Anchor (02:00-06:00)"

        for symbol in ["EURUSD", "GBPUSD"]:
            broker_sym = get_broker_symbol(symbol)
            rates = mt5.copy_rates_from_pos(broker_sym, mt5.TIMEFRAME_H4, 0, 10)
            if rates is None or len(rates) == 0:
                continue

            # Calcular la zona horaria del broker en base al tick actual
            tick = mt5.symbol_info_tick(broker_sym)
            if tick:
                server_dt = datetime.datetime.fromtimestamp(tick.time, tz=datetime.timezone.utc)
                local_dt = datetime.datetime.now(datetime.timezone.utc)
                offset_hours = round((server_dt - local_dt).total_seconds() / 3600.0)
            else:
                offset_hours = 2

            selected_rate = None
            for rate in reversed(rates):
                broker_start_dt = datetime.datetime.fromtimestamp(rate['time'])
                canary_start_dt = broker_start_dt - datetime.timedelta(hours=offset_hours)
                
                if canary_start_dt.hour == target_start_hour:
                    # Si es overnight (h < 6), buscar la vela de ayer a las 10:00
                    if current_hour < 6:
                        yesterday_date = (now_canary - datetime.timedelta(days=1)).date()
                        if canary_start_dt.date() == yesterday_date:
                            selected_rate = rate
                            break
                    else:
                        if canary_start_dt.date() == now_canary.date():
                            selected_rate = rate
                            break

            # Si no se encontró coincidencia perfecta, usar la vela cerrada anterior (index 1)
            if selected_rate is None and len(rates) > 1:
                selected_rate = rates[1]

            if selected_rate is not None:
                high = float(selected_rate['high'])
                low = float(selected_rate['low'])
                eq = low + 0.5 * (high - low)
                
                # Actualizar y notificar solo si cambió
                if anchor_ranges[symbol]["high"] != high or anchor_ranges[symbol]["low"] != low:
                    anchor_ranges[symbol].update({
                        "high": high,
                        "low": low,
                        "eq": eq,
                        "anchor_time": anchor_label
                    })
                    logger.info(f"Escáner: Rango de anclaje actualizado para {symbol}: High={high:.5f}, Low={low:.5f}, EQ={eq:.5f} ({anchor_label})")
                    
                    asyncio.create_task(broadcast({
                        "type": "anchor_update",
                        "symbol": symbol,
                        "high": high,
                        "low": low,
                        "eq": eq,
                        "anchor_time": anchor_label
                    }))
    except Exception as e:
        logger.error(f"Error en update_reference_ranges: {e}")

def is_in_active_killzone() -> bool:
    """Retorna True si la hora UTC actual está dentro de alguna killzone activa."""
    now_utc = datetime.datetime.now(datetime.timezone.utc).hour * 60 + datetime.datetime.now(datetime.timezone.utc).minute
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

                    direction = None
                    price = 0.0
                    
                    # Detección de Barrido (Sweep)
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

                        # --- CAPA 2/3: VALIDACIÓN DE CONTEXTO DE MERCADO ---
                        setup_name = f"Sweep {'High' if direction == 'SELL' else 'Low'} Reversal ({direction})"
                        market_snapshot = (
                            f"Symbol: {symbol}, Action: {direction}, Price: {price:.5f}, CRT_HIGH: {crt_high:.5f}, "
                            f"CRT_LOW: {crt_low:.5f}, ATR: {ltf_atr:.1f}, Spread: {current_spread_points/10.0:.1f} pips."
                        )
                        
                        # Obtener parámetros dinámicos del bot de manera segura para hilos
                        with _config_lock:
                            lot = bot_config.lot_size
                            tp_pips = bot_config.take_profit_pips
                            sl_pips = bot_config.stop_loss_pips
                            threshold = bot_config.chroma_threshold
                            top_k = bot_config.chroma_top_k

                        loop = asyncio.get_running_loop()
                        validation_res = await loop.run_in_executor(
                            None, validate_market_context, setup_name, market_snapshot, threshold, top_k
                        )
                        
                        if not validation_res.get("approved", True):
                            reason = validation_res.get("reason", "Bloqueado por exclusión vectorial.")
                            # Evitar spamming de desestimación por contexto
                            last_dism_time = last_scanner_action_time[symbol]["DISMISSED"]
                            if now_time - last_dism_time > 60:
                                last_scanner_action_time[symbol]["DISMISSED"] = now_time
                                await broadcast({
                                    "type": "scanner_signal",
                                    "symbol": symbol,
                                    "action": "DISMISSED",
                                    "direction": direction,
                                    "reason": f"Contexto: {reason}",
                                    "message": f"❌ Señal desestimada en {symbol}: {reason}"
                                })
                                logger.info(f"Escáner: Señal desestimada en {symbol}: {reason}")
                            continue

                        # --- AMBAS CAPAS APROBADAS: DISPARO AUTÓNOMO ---
                        # Calcular SL y TP usando los pips dinámicos configurados
                        if direction == "SELL":
                            sl_price = price + sl_pips * pip_value
                            tp_price = price - tp_pips * pip_value
                            order_type = mt5.ORDER_TYPE_SELL
                        else:
                            sl_price = price - sl_pips * pip_value
                            tp_price = price + tp_pips * pip_value
                            order_type = mt5.ORDER_TYPE_BUY

                        volume = lot  # Lotaje controlado desde el frontend
                        
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
                            "comment": f"Auto {direction} Reversal",
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
    global MT5_INITIALIZED
    while True:
        if MT5_INITIALIZED:
            try:
                positions = mt5.positions_get()
                if positions is not None:
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
                    
                    max_daily_loss = daily_starting_balance * (risk_config.get("max_daily_loss_pct", 4.5) / 100.0)
                    max_total_loss = daily_starting_balance * (risk_config.get("max_total_loss_pct", 8.0) / 100.0)
                    
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
                    "anchor_time": anchor_ranges[symbol]["anchor_time"]
                }))
    except Exception as e:
        logger.error(f"Error al enviar history_init al cliente: {e}")

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
                    setup_name = data.get("setup_name", f"Setup {action.upper()}")
                    market_snapshot = data.get("market_snapshot", f"Symbol: {symbol}, Volume: {volume}, SL: {sl}, TP: {tp}")
                    
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
                        
                    # --- CAPA 2/3: VALIDACIÓN DE CONTEXTO DE MERCADO ---
                    with _config_lock:
                        threshold = bot_config.chroma_threshold
                        top_k = bot_config.chroma_top_k

                    loop = asyncio.get_running_loop()
                    validation_res = await loop.run_in_executor(
                        None, validate_market_context, setup_name, market_snapshot, threshold, top_k
                    )
                    
                    if not validation_res.get("approved", True):
                        reason = validation_res.get("reason", "Bloqueado por exclusión de mercado.")
                        error_msg = f"Rechazo Contexto: {reason}"
                        logger.warning(f"MT5: Orden cancelada por CAPA 3 (Exclusión/Contexto): {reason}")
                        await send_to_client(websocket, {
                            "type": "trade_result",
                            "success": False,
                            "action": action,
                            "error": error_msg
                        })
                        continue
                    
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
    # Evitar duplicados
    processed_deals = set()
    
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
                            
                            trade_data = {
                                "symbol": symbol,
                                "type": original_type,
                                "outcome": outcome,
                                "pips_result": float(pips_result),
                                "spread": float(spread),
                                "setup_initial": setup_initial
                            }
                            
                            logger.info(f"Feedback Loop: Registrando trade en ChromaDB: Posición {position_id}, "
                                        f"Resultado: {outcome} ({pips_result:.1f} pips).")
                                        
                            # Ejecutar la inserción en ChromaDB en un hilo ejecutor no bloqueante y esperar resultado
                            loop = asyncio.get_running_loop()
                            new_trade = await loop.run_in_executor(None, add_trade_experience, trade_data)
                            
                            processed_deals.add(deal_ticket)
                            
                            if new_trade:
                                await broadcast({
                                    "type": "history_update",
                                    "trade": new_trade
                                })
                            
            except Exception as e:
                logger.error(f"Feedback Loop: Error en monitoreo de deals: {e}")
                
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