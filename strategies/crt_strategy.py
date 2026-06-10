# [CRT-IMPL-5] Implementacion CRT como estrategia pluggable
from strategies.base_strategy import IStrategy, MarketContext, StrategySignal, register_strategy
from crt_logic import classify_sweep_type, calculate_dynamic_sl, calculate_crt_targets

@register_strategy
class CRTStrategy(IStrategy):
    name = "crt"
    description = "CRT Institucional: sweep H4 + TBS/TWS + EQ targets"
    def evaluate(self, ctx: MarketContext) -> StrategySignal:
        if not ctx.vela_m1 or not ctx.vela_m1_prev:
            return StrategySignal(False, None, "Sin datos M1", None, 0.0, None, None, None)
        if ctx.bid > ctx.crt_high:
            direction = "SELL"
        elif ctx.ask < ctx.crt_low:
            direction = "BUY"
        else:
            return StrategySignal(False, None, "Precio dentro del rango", None, 0.0, None, None, None)
        resultado = classify_sweep_type(ctx.vela_m1_prev, ctx.vela_m1, ctx.crt_high, ctx.crt_low, direction)
        if resultado["type"] == "INVALID":
            return StrategySignal(False, direction, "Vela 3 no confirma", "INVALID", 0.0, None, None, None)
        sl = calculate_dynamic_sl(ctx.vela_m1_prev, direction, pip_value=0.0001)
        tgt = calculate_crt_targets(ctx.crt_high, ctx.crt_low, direction)
        mult = 1.0 if resultado["type"] == "TBS" else 0.5
        return StrategySignal(True, direction, f"{resultado['type']} confirmado", resultado["type"], resultado["confidence"], sl, tgt["tp1"], tgt["tp2"], mult)
