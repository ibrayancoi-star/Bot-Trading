import datetime
import os
import json
import logging
import math
import MetaTrader5 as mt5
import pandas as pd
import time
from crt_logic import validate_hard_rules, check_sweep, get_anchor_candle_params, find_anchor_candle
from context_engine import validate_market_context

logger = logging.getLogger("BacktestingEngine")

class BacktestError(Exception):
    pass

class DataLayer:
    @staticmethod
    def get_historical_data(symbol: str, timeframe: str, date_from: datetime.datetime, date_to: datetime.datetime) -> pd.DataFrame:
        """Fetches historical rates from MetaTrader 5."""
        if not mt5.initialize():
            raise BacktestError("MT5 no conectado. Abre MetaTrader 5.")
        
        # Map timeframe string to MT5 timeframe
        tf_map = {
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
        }
        mt5_tf = tf_map.get(timeframe)
        if mt5_tf is None:
            raise BacktestError(f"Timeframe '{timeframe}' no soportado.")

        # Ensure symbol is selected
        mt5.symbol_select(symbol, True)
        
        rates = mt5.copy_rates_range(symbol, mt5_tf, date_from, date_to)
        if rates is None or len(rates) == 0:
            raise BacktestError(f"Sin datos para {symbol} en el rango seleccionado")

        df = pd.DataFrame(rates)
        df['time'] = pd.to_datetime(df['time'], unit='s')
        return df

class SimEngine:
    @staticmethod
    def calculate_ema(prices, period):
        if len(prices) < period:
            return 0.0
        k = 2 / (period + 1)
        ema_val = sum(prices[:period]) / period
        for price in prices[period:]:
            ema_val = price * k + ema_val * (1 - k)
        return ema_val

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    def calculate_atr(highs, lows, closes, period=14):
        if len(closes) < period + 1:
            return 12.0 # default
        tr_sum = 0.0
        for i in range(1, len(closes)):
            h = highs[i]
            l = lows[i]
            pc = closes[i-1]
            tr = max(h - l, abs(h - pc), abs(l - pc))
            tr_sum += tr
        return tr_sum / (len(closes) - 1)

    @classmethod
    async def run(cls, df: pd.DataFrame, h4_df: pd.DataFrame, symbol: str, config: dict, ws_send_fn, is_running_check_fn):
        """Runs the candle-by-candle simulation loop."""
        initial_balance = 10000.0
        balance = initial_balance
        equity = initial_balance
        
        positions = []
        trades_history = []
        equity_curve = []
        
        # Parameter configuration
        lot_size = float(config.get("lotSize", 0.1))
        tp_pips = int(config.get("takeProfitPips", 20))
        sl_pips = int(config.get("stopLossPips", 15))
        chroma_threshold = float(config.get("chromaThreshold", 0.72))
        chroma_top_k = int(config.get("chromaTopK", 5))
        
        symbol_upper = symbol.upper()
        pip_value = 0.01 if "JPY" in symbol_upper else 0.0001
        
        # Load rule metadata
        config_rules = {}
        if os.path.exists("config_crt.json"):
            try:
                with open("config_crt.json", "r", encoding="utf-8") as f:
                    config_rules = json.load(f).get("capa_1_hard_rules", {})
            except Exception:
                pass

        total_candles = len(df)
        
        # H4 anchor state
        crt_high = 0.0
        crt_low = 0.0
        anchor_time = "Ninguno"
        
        for i in range(total_candles):
            if not is_running_check_fn():
                logger.info("Backtest detenido por el usuario.")
                break
                
            row = df.iloc[i]
            current_time = row['time']
            current_close = float(row['close'])
            current_high = float(row['high'])
            current_low = float(row['low'])
            current_open = float(row['open'])
            
            # 1. Update Indicators
            history_subset = df.iloc[max(0, i-150):i+1]
            closes_sub = history_subset['close'].tolist()
            highs_sub = history_subset['high'].tolist()
            lows_sub = history_subset['low'].tolist()
            
            ema_9 = cls.calculate_ema(closes_sub, 9)
            ema_21 = cls.calculate_ema(closes_sub, 21)
            rsi_val = cls.calculate_rsi(closes_sub, 14)
            m_val, sig_val, hist_val = cls.calculate_macd(closes_sub, 12, 26, 9)
            
            indicators_data = {
                "ema_9": ema_9,
                "ema_21": ema_21,
                "rsi": rsi_val,
                "macd": {"macd": m_val, "signal": sig_val, "histogram": hist_val}
            }
            
            # Send current candle update to frontend
            candle_msg = {
                "time": int(current_time.timestamp()),
                "open": current_open,
                "high": current_high,
                "low": current_low,
                "close": current_close,
                "volume": int(row.get('tick_volume', 100)),
                "isFinal": True,
                "indicators": indicators_data
            }
            await ws_send_fn({"type": "backtest_candle", "data": candle_msg})
            
            # 2. Update H4 Anchor ranges
            # Select H4 candle closed prior to this timestamp
            h4_subset = h4_df[h4_df['time'] < current_time]
            if not h4_subset.empty:
                # canary time conversion (offset hours fallback to 2)
                offset_hours = 2
                canary_time = current_time - datetime.timedelta(hours=offset_hours)
                
                target_start_hour, anchor_label = get_anchor_candle_params(canary_time)
                rates_list = h4_subset.to_dict('records')
                selected_h4 = find_anchor_candle(rates_list, target_start_hour, offset_hours, canary_time)
                
                if selected_h4:
                    high = float(selected_h4['high'])
                    low = float(selected_h4['low'])
                    if crt_high != high or crt_low != low:
                        crt_high = high
                        crt_low = low
                        anchor_time = anchor_label
                        await ws_send_fn({
                            "type": "anchor_update",
                            "symbol": symbol,
                            "high": crt_high,
                            "low": crt_low,
                            "eq": crt_low + 0.5 * (crt_high - crt_low),
                            "anchor_time": anchor_time
                        })

            # 3. Handle Active Positions (SL / TP Hits)
            active_p = []
            for p in positions:
                closed = False
                pnl_pips = 0.0
                pnl_cash = 0.0
                
                if p['type'] == 'buy':
                    # SL hit check
                    if current_low <= p['sl']:
                        closed = True
                        pnl_pips = (p['sl'] - p['open_price']) / pip_value
                    # TP hit check
                    elif current_high >= p['tp']:
                        closed = True
                        pnl_pips = (p['tp'] - p['open_price']) / pip_value
                else: # sell
                    # SL hit check
                    if current_high >= p['sl']:
                        closed = True
                        pnl_pips = (p['open_price'] - p['sl']) / pip_value
                    # TP hit check
                    elif current_low <= p['tp']:
                        closed = True
                        pnl_pips = (p['open_price'] - p['tp']) / pip_value
                        
                if closed:
                    # Calculate cash profit
                    pnl_cash = pnl_pips * pip_value * lot_size * 100000.0 # Standard lot size factor
                    balance += pnl_cash
                    
                    closed_trade = {
                        **p,
                        "close_price": p['sl'] if pnl_pips < 0 else p['tp'],
                        "close_time": int(current_time.timestamp()),
                        "pnl": pnl_cash,
                        "pnl_pips": pnl_pips,
                        "status": "closed"
                    }
                    trades_history.append(closed_trade)
                    await ws_send_fn({"type": "backtest_trade", "data": closed_trade})
                else:
                    active_p.append(p)
            positions = active_p

            # 4. Check for sweeps and open new positions
            if len(positions) == 0 and crt_high > 0 and crt_low > 0:
                direction = check_sweep(current_close, current_close, crt_high, crt_low)
                if direction:
                    # evaluate filters
                    raw_spread = 15.0 # mock standard spread points
                    raw_atr = cls.calculate_atr(highs_sub, lows_sub, closes_sub, 14) / pip_value
                    
                    m1_candle = {
                        "open": current_open,
                        "high": current_high,
                        "low": current_low,
                        "close": current_close
                    }
                    
                    canary_time = current_time - datetime.timedelta(hours=2)
                    range_size_pips = (crt_high - crt_low) / pip_value
                    
                    hard_ok, hard_msg = validate_hard_rules(
                        symbol, canary_time, raw_spread, range_size_pips, raw_atr, config_rules, config, m1_candle
                    )
                    
                    if hard_ok:
                        # IA context validation with retry mechanism
                        setup_name = f"Sweep {'High' if direction == 'SELL' else 'Low'} Reversal ({direction})"
                        market_snapshot = (
                            f"Symbol: {symbol}, Action: {direction}, Price: {current_close:.5f}, CRT_HIGH: {crt_high:.5f}, "
                            f"CRT_LOW: {crt_low:.5f}, ATR: {raw_atr:.1f}, Spread: {raw_spread/10.0:.1f} pips."
                        )
                        
                        chroma_ok = True
                        chroma_approved = True
                        chroma_reason = "Aprobado por defecto"
                        
                        # ChromaDB retry logic
                        for attempt in range(3):
                            try:
                                chroma_res = validate_market_context(setup_name, market_snapshot, chroma_threshold, chroma_top_k)
                                chroma_approved = chroma_res.get("approved", True)
                                chroma_reason = chroma_res.get("reason", "Bloqueado por exclusión.")
                                break
                            except Exception as e:
                                logger.warning(f"ChromaDB backtest retry {attempt+1} failed: {e}")
                                if attempt < 2:
                                    time.sleep(1.0)
                                else:
                                    chroma_ok = False # Falls back to validated: False
                        
                        if chroma_approved:
                            # Open trade
                            sl_price = current_close + sl_pips * pip_value if direction == 'SELL' else current_close - sl_pips * pip_value
                            tp_price = current_close - tp_pips * pip_value if direction == 'SELL' else current_close + tp_pips * pip_value
                            
                            new_pos = {
                                "ticket": int(time.time() * 1000) % 10000000,
                                "symbol": symbol,
                                "type": direction.lower(),
                                "volume": lot_size,
                                "open_price": current_close,
                                "sl": sl_price,
                                "tp": tp_price,
                                "time": int(current_time.timestamp()),
                                "chromadb_validated": chroma_ok,
                                "chromadb_approved": chroma_approved,
                                "reason": chroma_reason
                            }
                            positions.append(new_pos)
                            await ws_send_fn({"type": "backtest_trade", "data": new_pos})

            # Calculate floating equity
            floating_pnl = 0.0
            for p in positions:
                if p['type'] == 'buy':
                    floating_pnl += (current_close - p['open_price']) / pip_value * lot_size * 100000.0 * pip_value
                else:
                    floating_pnl += (p['open_price'] - current_close) / pip_value * lot_size * 100000.0 * pip_value
            
            equity = balance + floating_pnl
            equity_curve.append({"time": int(current_time.timestamp()), "equity": equity})
            await ws_send_fn({"type": "backtest_equity", "data": {"time": int(current_time.timestamp()), "equity": equity}})
            
            # Emit progress
            if i % max(1, total_candles // 100) == 0 or i == total_candles - 1:
                await ws_send_fn({
                    "type": "backtest_progress",
                    "data": {"current": i + 1, "total": total_candles}
                })
                
            # Keep stream realistic
            await asyncio.sleep(0.005)

        # Finalize backtest report and metrics
        metrics = ResultsStreamer.calculate_metrics(trades_history, initial_balance, equity_curve)
        await ws_send_fn({"type": "backtest_done", "data": metrics})
        
        # Save Markdown Log
        ResultsStreamer.write_markdown_log(symbol, timeframe, df.iloc[0]['time'], df.iloc[-1]['time'], config, trades_history, metrics)

class ResultsStreamer:
    @staticmethod
    def calculate_metrics(trades: list, initial_balance: float, equity_curve: list) -> dict:
        total_trades = len(trades)
        if total_trades == 0:
            return {
                "winRate": 0.0,
                "profitFactor": 0.0,
                "maxDrawdown": 0.0,
                "sharpeRatio": 0.0,
                "totalTrades": 0,
                "unvalidatedTradesCount": 0
            }
            
        wins = [t for t in trades if t['pnl'] > 0]
        losses = [t for t in trades if t['pnl'] <= 0]
        
        win_rate = (len(wins) / total_trades) * 100.0
        
        gross_profit = sum(t['pnl'] for t in wins)
        gross_loss = abs(sum(t['pnl'] for t in losses))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else (gross_profit if gross_profit > 0 else 1.0)
        
        # Max Drawdown
        peak = initial_balance
        max_dd = 0.0
        for eq_point in equity_curve:
            eq = eq_point['equity']
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak * 100.0
            if dd > max_dd:
                max_dd = dd
                
        # Sharpe ratio (simplified)
        returns = []
        for i in range(1, len(equity_curve)):
            ret = (equity_curve[i]['equity'] - equity_curve[i-1]['equity']) / equity_curve[i-1]['equity']
            returns.append(ret)
        avg_ret = sum(returns) / len(returns) if returns else 0.0
        std_ret = math.sqrt(sum((x - avg_ret)**2 for x in returns) / len(returns)) if len(returns) > 1 else 1.0
        sharpe = (avg_ret / std_ret) * math.sqrt(252) if std_ret > 0 else 0.0
        
        unvalidated = sum(1 for t in trades if not t.get("chromadb_validated", True))

        return {
            "winRate": round(win_rate, 2),
            "profitFactor": round(profit_factor, 2),
            "maxDrawdown": round(max_dd, 2),
            "sharpeRatio": round(sharpe, 2),
            "totalTrades": total_trades,
            "unvalidatedTradesCount": unvalidated
        }

    @staticmethod
    def write_markdown_log(symbol: str, timeframe: str, start_date, end_date, config: dict, trades: list, metrics: dict):
        os.makedirs("backtest_logs", exist_ok=True)
        filename = f"backtest_logs/{datetime.datetime.now().strftime('%Y-%m-%d')}_{symbol}_{timeframe}.md"
        
        # Generate Markdown lines
        lines = [
            f"# Backtest Report — {symbol} {timeframe}",
            f"Fecha ejecución: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"Rango analizado: {start_date} → {end_date}",
            f"Parámetros: LotSize={config.get('lotSize')} | TP={config.get('takeProfitPips')} | SL={config.get('stopLossPips')} | ChromaDB threshold={config.get('chromaThreshold')}",
            "",
            "## Métricas Globales",
            f"- Win Rate: {metrics['winRate']}%",
            f"- Profit Factor: {metrics['profitFactor']}",
            f"- Max Drawdown: {metrics['maxDrawdown']}%",
            f"- Sharpe Ratio: {metrics['sharpeRatio']}",
            f"- Total Operaciones: {metrics['totalTrades']}",
            f"- Operaciones sin validación ChromaDB: {metrics['unvalidatedTradesCount']}",
            "",
            "## Operaciones",
            "| # | Tipo | Entrada | Salida | P&L | ChromaDB | Detalle/Motivo |",
            "|---|------|---------|--------|-----|----------|----------------|"
        ]
        
        for idx, t in enumerate(trades):
            c_val = "✅ Validado" if t.get("chromadb_validated", True) else "⚠️ Fallo / Sin DB"
            lines.append(f"| {idx+1} | {t['type'].upper()} | {t['open_price']:.5f} | {t.get('close_price', 0.0):.5f} | {t.get('pnl', 0.0):.2f} | {c_val} | {t.get('reason', '')} |")
            
        # Killzone analysis
        lines.extend([
            "",
            "## Análisis por Killzone",
            "| Killzone | Trades | Win Rate | PF medio |",
            "|----------|--------|----------|----------|",
            "| London   | -      | -        | -        |",
            "| NY       | -      | -        | -        |",
            "",
            "## Notas para Optimización",
            "Generado automáticamente por el Hybrid Backtesting Engine."
        ])
        
        with open(filename, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        logger.info(f"Reporte de Backtesting guardado en {filename}")
