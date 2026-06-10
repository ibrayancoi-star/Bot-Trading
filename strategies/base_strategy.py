# [CRT-IMPL-5] Interfaz base para metodologias pluggables
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

@dataclass
class MarketContext:
    symbol: str
    bid: float
    ask: float
    spread_points: float
    atr_pips: float
    crt_high: float
    crt_low: float
    eq: float
    anchor_time: str
    vela_m1: Optional[dict] = None
    vela_m1_prev: Optional[dict] = None

@dataclass
class StrategySignal:
    approved: bool
    direction: Optional[str]
    reason: str
    sweep_type: Optional[str]
    confidence: float
    sl_price: Optional[float]
    tp1_price: Optional[float]
    tp2_price: Optional[float]
    lot_multiplier: float = 1.0

class IStrategy(ABC):
    name: str = "base"
    description: str = ""
    @abstractmethod
    def evaluate(self, ctx: MarketContext) -> StrategySignal:
        ...
    def on_trade_closed(self, profit: float, setup_context: str) -> None:
        pass

STRATEGY_REGISTRY: dict = {}
def register_strategy(cls):
    STRATEGY_REGISTRY[cls.name] = cls
    return cls
