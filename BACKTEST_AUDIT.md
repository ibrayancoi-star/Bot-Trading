# 🔍 BACKTEST AUDIT — Motor de Backtest vs Bot Live

> **Fecha de auditoría:** 2026-06-16
> **Archivos analizados:**
> - `backtesting_engine.py` (491 líneas)
> - `crt_logic.py` (263 líneas)
> - `mt5_bridge.py` (2269 líneas)
> - `context_engine.py` (328 líneas)
> - `config_crt.json` (63 líneas)

---

## 1. Tabla Comparativa LIVE vs BACKTEST por Fase

### 1.1 Detección de Sweep

| Aspecto | Live (`mt5_bridge.py` L858-863) | Backtest (`backtesting_engine.py` L296) | ¿Coinciden? |
|---|---|---|---|
| **Fuente de precio** | Tick real: `bid` para SELL, `ask` para BUY | `current_close` para ambos (cierre de vela) | ❌ **NO** |
| **Función utilizada** | Inline: `if bid > crt_high` / `if ask < crt_low` | `check_sweep(current_close, current_close, crt_high, crt_low)` — pasa `close` como bid Y ask | ❌ **NO** |
| **Granularidad** | Tick-by-tick a 10Hz (cada ~100ms) | Vela a vela (candle-by-candle) | ❌ **NO** |
| **Spread implícito** | Bid/ask reflejan spread real (bid ≠ ask) | Se pierde el spread: `bid = ask = close` | ❌ **NO** |
| **Cooldown** | 180s cooldown entre trades por símbolo (L804) | Sin cooldown entre trades | ❌ **NO** |
| **Max posiciones** | Verifica `max_positions` global (L779-784) | Solo abre si `len(positions) == 0` (máx 1) | ⚠️ PARCIAL |

**Impacto:** El backtest ve sweeps que el live nunca vería (o al revés). Un sweep intra-vela que toca bid>high pero close<high se detecta en live pero NO en backtest. Conversamente, un close que cruza el rango sin que bid/ask lo hiciera en live nunca ocurriría.

---

### 1.2 Confirmación TBS/TWS

| Aspecto | Live (`mt5_bridge.py` L822-888) | Backtest (`backtesting_engine.py`) | ¿Coinciden? |
|---|---|---|---|
| **`require_candle_confirmation`** | Sí — si está activo, guarda sweep pendiente, espera Vela 3 M1, llama `classify_sweep_type()` | ❌ **NO EXISTE** — no importa ni usa `classify_sweep_type` | ❌ **NO** |
| **Clasificación TBS/TWS** | `classify_sweep_type(vela_2, vela_3, ...)` → TBS/TWS/INVALID con confidence | Ausente. Toda señal se trata como genérica | ❌ **NO** |
| **Multiplicador de riesgo** | `model_tbs_risk_multiplier` (×1.0) / `model_tws_risk_multiplier` (×0.5) → ajusta volumen (L1017-1021) | Volumen fijo: `lot_size` del config sin ajuste | ❌ **NO** |
| **Timeout de confirmación** | 180s timeout si Vela 3 no confirma (L826) | N/A | ❌ **NO** |

**Impacto:** El backtest ejecuta TODA señal de sweep como si fuera TBS confianza 1.0. En live, un TWS de baja confianza entra con la mitad del lote o se descarta si es INVALID. El backtest sobreestima entradas.

---

### 1.3 SL Dinámico

| Aspecto | Live (`mt5_bridge.py` L997-1005) | Backtest (`backtesting_engine.py` L344-345) | ¿Coinciden? |
|---|---|---|---|
| **SL dinámico** | Si `use_dynamic_sl=True` y `sweep_vela_2` existe: `calculate_dynamic_sl(vela_2, direction, pip_value, buffer=1.5)` — detrás de mecha de Vela 2 | ❌ **NO EXISTE** — SL = `price ± sl_pips × pip_value` (pips fijos del config) | ❌ **NO** |
| **Función `calculate_dynamic_sl`** | Referenciada en L999 pero **NO IMPORTADA** (import L34 solo trae `classify_sweep_type, check_smt_divergence`) → 🐛 `NameError` si se ejecuta | No importada ni usada | ❌ AMBOS con problemas |

**Impacto:** Si `use_dynamic_sl=True` en live, el bot crasharía con `NameError`. El backtest ignora completamente esta funcionalidad. Ninguno la ejecuta correctamente.

---

### 1.4 Targets CRT (EQ / Extremo Opuesto)

| Aspecto | Live (`mt5_bridge.py` L1007-1012) | Backtest (`backtesting_engine.py` L344-345) | ¿Coinciden? |
|---|---|---|---|
| **TP en EQ / TP2 en extremo** | Si `use_crt_targets=True`: `calculate_crt_targets(crt_high, crt_low, direction)` → TP = tp2 (extremo opuesto) | ❌ **NO EXISTE** — TP = `price ± tp_pips × pip_value` (pips fijos) | ❌ **NO** |
| **Cierre parcial en EQ** | `partial_close_at_eq`: cierra % del volumen en EQ, mueve SL a breakeven (L1176-1201) | ❌ **NO EXISTE** | ❌ **NO** |
| **Función `calculate_crt_targets`** | Referenciada en L1009 pero **NO IMPORTADA** → 🐛 `NameError` si se ejecuta | No importada ni usada | ❌ AMBOS con problemas |

**Impacto:** Mismo problema que SL dinámico. Si las flags CRT están activas en live, crashea. El backtest usa targets fijos en pips, lo que distorsiona completamente el ratio riesgo/beneficio del sistema CRT.

---

### 1.5 SMT Divergence

| Aspecto | Live (`mt5_bridge.py` L931-952) | Backtest (`backtesting_engine.py`) | ¿Coinciden? |
|---|---|---|---|
| **Verificación SMT** | Si `smt_divergence_enabled=True`: compara sweep del par primario vs correlacionado en tiempo real, usa `check_smt_divergence()` | ❌ **NO EXISTE** — sin importación ni lógica | ❌ **NO** |
| **Efecto en operativa** | Si ambos pares barren → descarta señal (filtro fuerte) | Sin filtro → entra en todas | ❌ **NO** |

**Impacto:** El backtest no filtra señales por SMT. Si el par correlacionado también barrió (sin divergencia institucional), el live descartaría, pero el backtest entraría. Sobreestima trades válidos.

---

### 1.6 Filtros Capa 1 (Spread, ATR, Mecha, Dimensión)

| Filtro | Live (`mt5_bridge.py` L316-478) | Backtest (`backtesting_engine.py` L298-314) | ¿Coinciden? |
|---|---|---|---|
| **Horario/Killzones** | `datetime.now(ZoneInfo("Atlantic/Canary"))` — hora real en Canarias | Pasa `canary_time = current_time - timedelta(hours=2)` — offset fijo de 2h | ⚠️ PARCIAL |
| **Spread** | `(tick.ask - tick.bid) / sym_info.point` — spread REAL del broker | **Hardcoded `raw_spread = 15.0`** (L299) — siempre 1.5 pips | ❌ **NO** |
| **ATR** | `get_current_atr()` → lee últimas 15 velas M1 en tiempo real desde MT5 | `calculate_atr()` sobre subset de velas del backtest → correcto conceptualmente | ✅ SÍ (aprox.) |
| **Mecha/Cuerpo** | Lee última vela M1 real: `mt5.copy_rates_from_pos(sym, M1, 0, 1)` | Pasa la vela actual del DF como `m1_candle` | ⚠️ PARCIAL |
| **Dimensión** | Lee `tick.bid` real para cálculo de amplitud % | Usa `m1_candle.close` como fallback | ⚠️ PARCIAL |
| **Función invocada** | `validate_hard_rules()` INLINE en mt5_bridge (L316) — lee `bot_config` con lock, lee `config_crt.json` en cada llamada | `validate_hard_rules()` de `crt_logic.py` (L9) — recibe parámetros explícitos | ⚠️ PARCIAL |
| **Bypass flags** | Lee dinámicamente de `bot_config`: `disable_spread_filter`, `disable_atr_filter`, etc. con `_config_lock` | Los bypass se pasan dentro del dict `config` que viene del frontend | ✅ SÍ |

**Impacto CRÍTICO del spread hardcodeado:** El filtro de spread en backtest **NUNCA** rechazará una señal porque `15.0 puntos = 1.5 pips` es casi siempre inferior al umbral (`max_spread_points=20.0`, ratio 20% del ATR). El backtest infla artificialmente el número de trades que pasan el filtro.

---

### 1.7 ChromaDB

| Aspecto | Live (`mt5_bridge.py` L954-984) | Backtest (`backtesting_engine.py` L324-340) | ¿Coinciden? |
|---|---|---|---|
| **Función utilizada** | `validate_market_context_async(symbol, direction, sweep_type, killzone, ...)` (versión nueva, informativa) | `validate_market_context(setup_name, market_snapshot, threshold, top_k)` (versión antigua, bloqueante) | ❌ **NO** |
| **Firma de la función** | 5 args: symbol, direction, sweep_type, killzone, threshold, top_k | 4 args: setup_name (texto libre), market_snapshot (texto libre), threshold, top_k | ❌ **NO** |
| **Efecto en operativa LIVE** | `approved` siempre `True` — INFORMATIVO, nunca bloquea (L963 comment) | `chroma_approved` se evalúa y **BLOQUEA** el trade si es `False` (L342) | ❌ **INVERSO** |
| **Versión de API** | `validate_market_context(symbol, direction, ...)` con query estructurado `SYM:|DIR:|SWEEP:|KZ:` | Llama con `(setup_name, market_snapshot, ...)` — estos args no coinciden con la firma actual (symbol, direction, ...) → 🐛 **TypeError en runtime** | ❌ **ROTO** |
| **Retry** | No aplica (siempre informativo, error = continuar) | 3 retries con `time.sleep(1.0)` bloqueantes (L329-340) | ❌ **NO** |

**Impacto CRÍTICO:** El backtest usa una firma de `validate_market_context()` que ya NO existe en `context_engine.py`. La función actual espera `(symbol, direction, sweep_type, killzone, threshold, top_k)`, pero el backtest le pasa `(setup_name_string, market_snapshot_string, threshold, top_k)`. Esto causa un **TypeError** en runtime. Si de alguna forma funciona (¿archivo antiguo?), ChromaDB en backtest **BLOQUEA** trades, mientras que en live **NUNCA** los bloquea.

---

### 1.8 Gestión de Posiciones

| Aspecto | Live | Backtest | ¿Coinciden? |
|---|---|---|---|
| **Resolución SL/TP hit** | MT5 ejecuta SL/TP a nivel de tick, con slippage real | Backtest: verifica con `low ≤ SL` o `high ≥ TP` por vela → no sabe cuál se tocó primero | ❌ **NO** |
| **Prioridad SL vs TP** | MT5 ejecuta el primero que toque | Backtest evalúa SL primero, TP después (L258-264) → sesgo pro-SL en velas que tocan ambos | ⚠️ SESGO |
| **Trailing stop** | Flag `trailing_stop` existe en BotConfig (L57) pero no hay lógica implementada | No implementado | ✅ (ambos nulo) |
| **Risk Guard** | Drawdown diario/total → cierre pánico → bloqueo de operativa (L1324-1372) | ❌ **NO EXISTE** | ❌ **NO** |
| **Max posiciones** | `bot_config.max_positions` limita posiciones globales | Solo permite 1 posición simultánea (hardcoded `len(positions) == 0`) | ❌ **NO** |

---

## 2. Modelado de Costes en Backtest

### 2.1 Spread

| Parámetro | Valor | Fuente |
|---|---|---|
| **Tipo** | **FIJO hardcoded** | `backtesting_engine.py` L299 |
| **Valor** | `15.0 puntos` (= 1.5 pips en pares no-JPY) | Constante en código |
| **Aplicación al precio de entrada** | ❌ **NO SE APLICA** — la entrada usa `current_close` sin descontar spread | El spread solo se pasa al filtro `validate_hard_rules` |
| **Vs realidad** | Spread real EUR/USD varía de 5-50+ puntos según broker, hora y volatilidad | — |

> ⚠️ **El spread NO se descuenta del precio de apertura.** Un BUY abre a `close` en vez de a `close + spread/2` (ask). Un SELL abre a `close` en vez de a `close - spread/2` (bid). Esto infla los resultados del backtest.

### 2.2 Slippage

| Parámetro | Valor |
|---|---|
| **Slippage modelado** | ❌ **NINGUNO** |
| **Deviation en live** | `20 puntos` (L1031) |
| **Efecto** | Backtest asume fill perfecto al precio de cierre de vela. En live, el slippage puede ser 0.5-3 pips. |

### 2.3 Comisiones

| Parámetro | Valor |
|---|---|
| **Comisiones modeladas** | ❌ **NINGUNA** |
| **Efecto** | Brokers ECN cobran típicamente $3-7 por lote roundtrip. No se descuenta del P&L. |

### 2.4 Cálculo de P&L

| Aspecto | Código (L277) | Problema |
|---|---|---|
| **Fórmula** | `pnl_cash = pnl_pips × pip_value × lot_size × 100000` | `pip_value` aparece dos veces conceptualmente: una en `pnl_pips = (exit - entry) / pip_value` y otra en la multiplicación. El factor 100000 convierte a lote estándar, lo que resulta en `(exit - entry) × lot_size × 100000` que es correcto para Forex, pero la legibilidad y el desglose intermedio son confusos. |

---

## 3. Lista de Discrepancias que Hacen que el Backtest Mienta

### 🔴 Críticas (invalidan los resultados)

| # | Discrepancia | Efecto en resultados |
|---|---|---|
| **D1** | Sweep por cierre de vela vs tick real (bid/ask) | Trades fantasma: detecta sweeps que nunca ocurrieron en tiempo real, o pierde sweeps intra-vela |
| **D2** | Spread hardcoded a 1.5 pips, NO descontado de la entrada | Infla win rate y profit factor. Cada trade ahorra ~1.5 pips de coste real |
| **D3** | Sin slippage ni comisiones | Infla P&L en ~$3-10 por trade (comisiones) + variable por slippage |
| **D4** | ChromaDB llama a función con firma incorrecta → TypeError | Si crashea, `chroma_ok=False` pero `chroma_approved` nunca se setea → backtest podría bloquear o admitir trades incorrectamente |
| **D5** | ChromaDB en backtest BLOQUEA trades; en live es INFORMATIVO | El backtest rechaza trades que el live SÍ tomaría, o viceversa |

### 🟡 Severas (distorsionan significativamente)

| # | Discrepancia | Efecto en resultados |
|---|---|---|
| **D6** | Sin confirmación TBS/TWS (classify_sweep_type ausente) | Backtest trata toda señal como de máxima confianza |
| **D7** | Sin SMT Divergence | Backtest no filtra señales sin divergencia institucional |
| **D8** | SL/TP fijos en pips en vez de SL dinámico y targets CRT (EQ/extremo) | Ratio R:R completamente distinto al del bot live cuando las flags CRT están activas |
| **D9** | Prioridad SL sobre TP en velas que tocan ambos | Sesgo bajista: en velas muy volátiles, siempre se ejecuta SL primero |
| **D10** | Sin cierre parcial en EQ ni movimiento de SL a breakeven | Distorsiona curva de equity y drawdown |

### 🟠 Moderadas

| # | Discrepancia | Efecto en resultados |
|---|---|---|
| **D11** | Offset horario fijo (2h) vs cálculo dinámico del broker offset | Puede seleccionar vela H4 de anclaje incorrecta en DST |
| **D12** | Sin cooldown de 180s entre trades por símbolo | Backtest puede abrir trades consecutivos en la misma señal |
| **D13** | Sin Risk Guard (drawdown diario/total) | Backtest no para de operar tras drawdown excesivo |
| **D14** | `max_positions` es siempre 1 en backtest vs configurable en live | Distorsiona la frecuencia de trades |
| **D15** | `asyncio.sleep(0.005)` artificial por vela ralentiza sin aportar fidelidad | N/A en fidelidad, pero ineficiente |

---

## 4. Veredicto

# ❌ NO — El backtest NO representa fielmente al bot live

El motor de backtest es una **simplificación extrema** del scanner live. Las discrepancias más graves son:

1. **Detección de sweep incompatible** (tick vs vela)
2. **Cero modelado de costes** (spread no descontado, sin slippage ni comisiones)
3. **ChromaDB roto** (firma incorrecta + semántica invertida: bloquea vs informativo)
4. **Ausencia total del pipeline CRT** (TBS/TWS, SL dinámico, targets EQ/extremo, cierre parcial, SMT)

### ¿Qué falta para que sea fiel?

| Prioridad | Mejora necesaria |
|---|---|
| 🔴 P0 | Modelar spread variable: descontar spread del precio de apertura (BUY abre a ask = close + spread/2; SELL abre a bid = close - spread/2) |
| 🔴 P0 | Añadir slippage configurable (al menos fijo, ej. 0.5-1 pip) |
| 🔴 P0 | Añadir comisiones por lote roundtrip |
| 🔴 P0 | Arreglar ChromaDB: actualizar la llamada a la firma actual de `validate_market_context` o eliminar la consulta ChromaDB del backtest (ya que en live es meramente informativa) |
| 🟡 P1 | Implementar TBS/TWS: importar `classify_sweep_type`, simular Vela 2 / Vela 3 con velas consecutivas |
| 🟡 P1 | Implementar SL dinámico (`calculate_dynamic_sl`) y targets CRT (`calculate_crt_targets`) cuando las flags estén activas |
| 🟡 P1 | Implementar SMT Divergence: consultar datos del par correlacionado |
| 🟡 P1 | Resolver ambigüedad SL/TP en misma vela: cuando `low ≤ SL` y `high ≥ TP`, usar velas internas (ej. M1 si el backtest es H1) o aleatorizar |
| 🟡 P1 | Añadir cierre parcial en EQ y movimiento de SL a breakeven |
| 🟠 P2 | Implementar cooldown de 180s entre trades |
| 🟠 P2 | Calcular offset horario del broker dinámicamente en vez de hardcode 2h |
| 🟠 P2 | Implementar Risk Guard (drawdown diario/total) |
| 🟠 P2 | Hacer `max_positions` configurable |

---

## Apéndice: Bug Latente en Live (`mt5_bridge.py`)

> [!CAUTION]
> Las funciones `calculate_dynamic_sl` y `calculate_crt_targets` se **usan** en `mt5_bridge.py` (líneas 999 y 1009) pero **NO se importan** (línea 34 solo importa `classify_sweep_type` y `check_smt_divergence`). Si `use_dynamic_sl=True` o `use_crt_targets=True` en la config, el bot live crasheará con `NameError`. Actualmente no crashea porque ambas flags tienen default `False`, pero es una bomba de tiempo.

**Fix requerido en `mt5_bridge.py` línea 34:**
```python
# Actual:
from crt_logic import classify_sweep_type, check_smt_divergence

# Debe ser:
from crt_logic import classify_sweep_type, check_smt_divergence, calculate_dynamic_sl, calculate_crt_targets
```
