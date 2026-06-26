import os
import time
import datetime
import logging
import numpy as np
import MetaTrader5 as mt5

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("TickData")

def get_broker_symbol(symbol: str) -> str:
    """Busca el nombre del símbolo admitido por el bróker (p. ej. resolviendo sufijos tipo EURUSD.ecn)."""
    try:
        info = mt5.symbol_info(symbol)
        if info is not None:
            return symbol
        symbols = mt5.symbols_get()
        if symbols:
            for s in symbols:
                if s.name.upper().startswith(symbol.upper()):
                    return s.name
    except Exception:
        pass
    return symbol

def fetch_day(symbol: str, day: datetime.date) -> int:
    """
    Downloads ticks for a single day and saves them into tick_cache.
    If the day has no ticks (e.g. weekend), it saves empty arrays to avoid duplicate requests.
    """
    if not mt5.initialize():
        logger.error("MetaTrader 5 failed to initialize in fetch_day.")
        return 0

    date_from = datetime.datetime.combine(day, datetime.time.min)
    date_to = date_from + datetime.timedelta(days=1)

    ticks = None
    for attempt in range(3):
        ticks = mt5.copy_ticks_range(symbol, date_from, date_to, mt5.COPY_TICKS_INFO)
        if ticks is not None:
            break
        logger.warning(f"Attempt {attempt + 1} to copy ticks for {symbol} on {day} returned None. Retrying...")
        time.sleep(1.0)

    if ticks is None:
        logger.error(f"Failed to fetch ticks for {symbol} on {day} after 3 attempts. Saving empty.")
        time_msc_arr = np.array([], dtype=np.int64)
        bid_arr = np.array([], dtype=np.float64)
        ask_arr = np.array([], dtype=np.float64)
    elif len(ticks) > 0:
        time_msc_arr = ticks['time_msc'].astype(np.int64)
        bid_arr = ticks['bid'].astype(np.float64)
        ask_arr = ticks['ask'].astype(np.float64)
    else:
        time_msc_arr = np.array([], dtype=np.int64)
        bid_arr = np.array([], dtype=np.float64)
        ask_arr = np.array([], dtype=np.float64)

    os.makedirs(f"tick_cache/{symbol}", exist_ok=True)
    filepath = f"tick_cache/{symbol}/{day.strftime('%Y-%m-%d')}.npz"
    np.savez_compressed(filepath, time_msc=time_msc_arr, bid=bid_arr, ask=ask_arr)
    return len(time_msc_arr)

def sync(symbols: list, date_from: datetime.date, date_to: datetime.date):
    """
    Synchronizes tick data incrementally.
    Skips already cached files except the last day which might be incomplete (today).
    """
    if not mt5.initialize():
        logger.error("MetaTrader 5 failed to initialize in sync.")
        return

    total_days = (date_to - date_from).days + 1
    delta = datetime.timedelta(days=1)

    for symbol in symbols:
        # Check symbol selection
        if not mt5.symbol_select(symbol, True):
            logger.error(f"Symbol {symbol} could not be selected in MT5.")
            continue

        logger.info(f"Syncing ticks for {symbol} from {date_from} to {date_to} ({total_days} days)...")
        current_date = date_from
        day_counter = 0

        while current_date <= date_to:
            day_counter += 1
            is_last_day = (current_date == date_to)
            filepath = f"tick_cache/{symbol}/{current_date.strftime('%Y-%m-%d')}.npz"

            if os.path.exists(filepath) and not is_last_day:
                # Cache hit
                current_date += delta
                continue

            ticks_count = fetch_day(symbol, current_date)
            logger.info(f"[{day_counter}/{total_days}] {current_date.strftime('%Y-%m-%d')}: {ticks_count} ticks saved.")
            current_date += delta

def load_ticks(symbol: str, date_from: datetime.date, date_to: datetime.date) -> tuple:
    """
    Ensures all days in the range are cached and then loads and concatenates them.
    """
    current_date = date_from
    delta = datetime.timedelta(days=1)
    needed_days = []

    while current_date <= date_to:
        needed_days.append(current_date)
        current_date += delta

    # Sync any missing days
    for day in needed_days:
        filepath = f"tick_cache/{symbol}/{day.strftime('%Y-%m-%d')}.npz"
        is_last_day = (day == date_to)
        if not os.path.exists(filepath) or is_last_day:
            fetch_day(symbol, day)

    all_time_msc = []
    all_bid = []
    all_ask = []

    for day in needed_days:
        filepath = f"tick_cache/{symbol}/{day.strftime('%Y-%m-%d')}.npz"
        if os.path.exists(filepath):
            try:
                with np.load(filepath) as data:
                    if 'time_msc' in data and len(data['time_msc']) > 0:
                        all_time_msc.append(data['time_msc'])
                        all_bid.append(data['bid'])
                        all_ask.append(data['ask'])
            except Exception as e:
                logger.error(f"Error loading cache file {filepath}: {e}")

    if not all_time_msc:
        return (np.array([], dtype=np.int64),
                np.array([], dtype=np.float64),
                np.array([], dtype=np.float64))

    return (np.concatenate(all_time_msc),
            np.concatenate(all_bid),
            np.concatenate(all_ask))

def build_bars(ticks: tuple, tf_seconds: int) -> list:
    """
    Resamples bid ticks to OHLCV format.
    Volume is count of ticks.
    Time is the server time of start of the bucket.
    """
    time_msc, bid, ask = ticks
    if len(time_msc) == 0:
        return []

    # Bucket timestamps in seconds
    tick_times_sec = time_msc // 1000
    bucket_times = (tick_times_sec // tf_seconds) * tf_seconds

    # Find boundaries where bucket changes
    change_indices = np.where(bucket_times[:-1] != bucket_times[1:])[0] + 1
    split_indices = np.concatenate(([0], change_indices, [len(bucket_times)]))

    bars = []
    for idx in range(len(split_indices) - 1):
        start = split_indices[idx]
        end = split_indices[idx + 1]

        bucket_time = int(bucket_times[start])
        bid_slice = bid[start:end]

        o = float(bid_slice[0])
        h = float(np.max(bid_slice))
        l = float(np.min(bid_slice))
        c = float(bid_slice[-1])
        v = int(end - start)

        bars.append({
            "time": bucket_time,
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": v,
            "isFinal": True
        })

    return bars

def validate_against_mt5(symbol: str, tf_str: str, n: int = 100) -> bool:
    """
    Validates reconstructed bars against copy_rates from MT5.
    """
    if not mt5.initialize():
        logger.error("MetaTrader 5 failed to initialize for validation.")
        return False

    tf_secs_map = {
        "1m": 60,
        "5m": 300,
        "15m": 900,
        "1h": 3600,
        "4h": 14400,
        "1d": 86400
    }
    tf_map = {
        "1m": mt5.TIMEFRAME_M1,
        "5m": mt5.TIMEFRAME_M5,
        "15m": mt5.TIMEFRAME_M15,
        "1h": mt5.TIMEFRAME_H1,
        "4h": mt5.TIMEFRAME_H4,
        "1d": mt5.TIMEFRAME_D1
    }

    tf_seconds = tf_secs_map.get(tf_str)
    mt5_tf = tf_map.get(tf_str)
    if not tf_seconds or not mt5_tf:
        logger.error(f"Timeframe '{tf_str}' not supported for validation.")
        return False

    # Get broker symbol name mapping
    broker_symbol = get_broker_symbol(symbol)

    logger.info(f"Copying {n} historical rates for {broker_symbol} from MT5...")
    # Get rates, skip the in-formation one (index 0 is current rate, start_pos = 1 gets closed ones)
    rates = mt5.copy_rates_from_pos(broker_symbol, mt5_tf, 1, n)
    if rates is None or len(rates) == 0:
        logger.error(f"Could not copy rates from MT5 for {broker_symbol}.")
        return False

    start_time = int(rates[0]['time'])
    end_time = int(rates[-1]['time']) + tf_seconds

    date_from = datetime.datetime.utcfromtimestamp(start_time).date()
    date_to = datetime.datetime.utcfromtimestamp(end_time).date()

    logger.info(f"Loading ticks from {date_from} to {date_to}...")
    ticks = load_ticks(broker_symbol, date_from, date_to)
    if len(ticks[0]) == 0:
        logger.error("No ticks loaded for validation.")
        return False

    logger.info("Resampling ticks...")
    reconstructed_bars = build_bars(ticks, tf_seconds)
    reconstructed_map = {b['time']: b for b in reconstructed_bars if start_time <= b['time'] <= int(rates[-1]['time'])}

    matched = 0
    mismatches = 0
    tol = 1.0001e-5

    logger.info("Comparing OHLC values...")
    for rate in rates:
        rate_time = int(rate['time'])
        if rate_time not in reconstructed_map:
            logger.warning(f"Vela en {datetime.datetime.utcfromtimestamp(rate_time)} no se encuentra reconstruida.")
            mismatches += 1
            continue

        r_bar = reconstructed_map[rate_time]
        diff_o = abs(r_bar['open'] - float(rate['open']))
        diff_h = abs(r_bar['high'] - float(rate['high']))
        diff_l = abs(r_bar['low'] - float(rate['low']))
        diff_c = abs(r_bar['close'] - float(rate['close']))

        if diff_o > tol or diff_h > tol or diff_l > tol or diff_c > tol:
            logger.warning(
                f"Discrepancia en {datetime.datetime.fromtimestamp(rate_time)}:\n"
                f"  MT5: O={rate['open']:.5f}, H={rate['high']:.5f}, L={rate['low']:.5f}, C={rate['close']:.5f}\n"
                f"  Rec: O={r_bar['open']:.5f}, H={r_bar['high']:.5f}, L={r_bar['low']:.5f}, C={r_bar['close']:.5f}"
            )
            mismatches += 1
        else:
            matched += 1

    logger.info(f"Validación finalizada para {broker_symbol} {tf_str}: {matched} coincidencias, {mismatches} discrepancias.")
    return mismatches == 0

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Uso:")
        print("  python tick_data.py sync [EURUSD,GBPUSD] [2026-01-02] [YYYY-MM-DD]")
        print("  python tick_data.py validate [EURUSD] [1m|5m|15m|1h|4h|1d]")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "sync":
        symbols = ["EURUSD", "GBPUSD"]
        if len(sys.argv) > 2:
            symbols = sys.argv[2].split(",")

        date_from = datetime.date(2026, 1, 2)
        if len(sys.argv) > 3:
            date_from = datetime.datetime.strptime(sys.argv[3], "%Y-%m-%d").date()

        date_to = datetime.date.today()
        if len(sys.argv) > 4:
            date_to = datetime.datetime.strptime(sys.argv[4], "%Y-%m-%d").date()

        sync(symbols, date_from, date_to)

    elif cmd == "validate":
        symbol = "EURUSD"
        if len(sys.argv) > 2:
            symbol = sys.argv[2]

        tf = "1m"
        if len(sys.argv) > 3:
            tf = sys.argv[3]

        validate_against_mt5(symbol, tf)
