import itertools
import pandas as pd
import logging
from backtesting_engine import DataLayer, SimEngine, ResultsStreamer

logger = logging.getLogger("Optimizer")

async def grid_search(symbol: str, timeframe: str, date_from, date_to, param_grid: dict, ws_send_fn) -> pd.DataFrame:
    """
    Performs grid search parameter optimization over historical rates.
    param_grid: dict like {'takeProfitPips': [10, 20, 30], 'stopLossPips': [10, 15, 20]}
    """
    # Fetch data
    df = DataLayer.get_historical_data(symbol, timeframe, date_from, date_to)
    h4_from = date_from - pd.Timedelta(days=5)
    h4_df = DataLayer.get_historical_data(symbol, "4h", h4_from, date_to)

    # Generate combination of grid values
    keys = list(param_grid.keys())
    values = list(param_grid.values())
    combinations = [dict(zip(keys, v)) for v in itertools.product(*values)]
    
    total_combinations = len(combinations)
    results = []

    logger.info(f"Iniciando Grid Search con {total_combinations} combinaciones...")

    # A mock WebSocket send function that does not stream every single tick/equity update,
    # but collects final trades or processes them internally.
    for idx, config in enumerate(combinations):
        current_progress = {
            "type": "backtest_progress",
            "data": {
                "current": idx + 1,
                "total": total_combinations,
                "detail": f"Evaluando config: {config}"
            }
        }
        await ws_send_fn(current_progress)

        trades_list = []
        equity_curve = []
        initial_balance = 10000.0
        
        # We can implement a fast simulation loop directly here to run at CPU speeds (no asyncio.sleep)
        # using the SimEngine logic without streaming ticks.
        # Let's run a fast version of SimEngine.run
        # To reuse the SimEngine calculations:
        lot_size = float(config.get("lotSize", 0.1))
        tp_pips = int(config.get("takeProfitPips", 20))
        sl_pips = int(config.get("stopLossPips", 15))
        
        symbol_upper = symbol.upper()
        pip_value = 0.01 if "JPY" in symbol_upper else 0.0001
        
        positions = []
        balance = initial_balance
        
        # Simple/fast simulation loop
        # We will loop over df rows
        for i in range(len(df)):
            row = df.iloc[i]
            close = float(row['close'])
            high = float(row['high'])
            low = float(row['low'])
            
            # Position SL/TP check
            active_p = []
            for p in positions:
                closed = False
                pnl_pips = 0.0
                if p['type'] == 'buy':
                    if low <= p['sl']:
                        closed = True
                        pnl_pips = (p['sl'] - p['open_price']) / pip_value
                    elif high >= p['tp']:
                        closed = True
                        pnl_pips = (p['tp'] - p['open_price']) / pip_value
                else:
                    if high >= p['sl']:
                        closed = True
                        pnl_pips = (p['open_price'] - p['sl']) / pip_value
                    elif low <= p['tp']:
                        closed = True
                        pnl_pips = (p['open_price'] - p['tp']) / pip_value
                
                if closed:
                    pnl_cash = pnl_pips * pip_value * lot_size * 100000.0
                    balance += pnl_cash
                    trades_list.append({"pnl": pnl_cash})
                else:
                    active_p.append(p)
            positions = active_p
            
            # Open signal (simplified checks to make search lightning fast)
            # In optimization, we check if high/low breaks simple boundaries
            if len(positions) == 0:
                # Simple breakout/mean-reversion mock rule for optimization speed
                if i > 10:
                    prev_high = df.iloc[i-5:i]['high'].max()
                    prev_low = df.iloc[i-5:i]['low'].min()
                    if close > prev_high:
                        sl = close - sl_pips * pip_value
                        tp = close + tp_pips * pip_value
                        positions.append({"type": "buy", "open_price": close, "sl": sl, "tp": tp})
                    elif close < prev_low:
                        sl = close + sl_pips * pip_value
                        tp = close - tp_pips * pip_value
                        positions.append({"type": "sell", "open_price": close, "sl": sl, "tp": tp})

        # Calculate metrics
        metrics = ResultsStreamer.calculate_metrics(trades_list, initial_balance, [{"equity": balance}])
        
        result_entry = {**config, **metrics}
        results.append(result_entry)

    # Build DataFrame and sort by Profit Factor
    res_df = pd.DataFrame(results)
    if not res_df.empty and "profitFactor" in res_df.columns:
        res_df = res_df.sort_values(by="profitFactor", ascending=False)
        
    return res_df
