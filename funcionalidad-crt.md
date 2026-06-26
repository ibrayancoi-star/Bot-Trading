# Funcionalidad CRT — Análisis técnico real del bot

> Documento generado a partir de una lectura directa del código vivo (`mt5_bridge.py`,
> `crt_logic.py`, `context_engine.py`) a fecha **2026-06-23**. Describe lo que el código
> **realmente hace hoy**, incluyendo inconsistencias, código muerto y flags sin efecto.
> No es marketing ni teoría: es el estado real.

---

## 1. Qué es y cómo se conecta

El bot implementa una estrategia **CRT (Candle Range Theory) / Turtle Soup**: define un **rango
de referencia** (vela de anclaje), espera un **barrido de liquidez** (sweep) de uno de sus
extremos, confirma el rechazo y entra a favor de la reversión, con objetivos en el EQ (50%) y el
extremo opuesto.

**Arquitectura (sin cTrader/Binance, ya eliminados):**

```
Frontend Next.js  ──ws://127.0.0.1──►  mt5_bridge.py  ──►  MetaTrader 5 (terminal local)
                                          │
                                          └──►  context_engine.py (ChromaDB, informativo)
```

`mt5_bridge.py` corre varias tareas asíncronas en paralelo (1 Hz aprox.):
- `check_mt5_connection` — conecta/reconecta a MT5 ([mt5_bridge.py:1204](mt5_bridge.py:1204)).
- `strategy_scanner_task` — el cerebro CRT ([mt5_bridge.py:859](mt5_bridge.py:859)).
- `positions_broadcaster` — posiciones + cierre parcial en EQ ([mt5_bridge.py:1298](mt5_bridge.py:1298)).
- `tick_broadcaster`, Feedback Loop (ChromaDB), Risk Guard, `handler` WebSocket.

---

## 2. Determinación de rangos (núcleo de la estrategia)

Hay **dos** rangos, calculados con **criterios distintos** (esto es una inconsistencia real, ver §9):

### 2.1 Rango H4 (vela de anclaje) — `update_reference_ranges` ([mt5_bridge.py:566](mt5_bridge.py:566))

Se calcula **solo para EURUSD y GBPUSD** (hardcodeado en [L583]). Trae 60 velas H4, separa la
**en formación** (`rates_h4[-1]`, evalúa pero no es candidata) de las **cerradas**. Escanea de la
más reciente hacia atrás y aplica esta **jerarquía de selección** ([L607-647]):

1. `first_accumulation` — contenida (±tol) + **no rota** + es **acumulación real**.
2. `first_valid` — contenida (±tol) + no rota.
3. `first_contained` — **encierra el precio** (bracket estricto `low ≤ bid ≤ high`), aunque esté rota.
4. `closed[-1]` — última cerrada (fallback final).

Selección con `if/elif` explícito y `is not None` (no `or`) **porque `cand` es un registro numpy
cuyo `bool()` es ambiguo** ([L640]).

**Componentes:**
- **Gate de contención** ([L618]): descarta candidatas si `bid > high+tol` o `bid < low-tol`. Usa
  `±tol` (no estricto) para no deseleccionar la vela durante un sweep activo de pocos pips.
- **Ruptura** `_h4_range_broken` ([~mt5_bridge.py:511](mt5_bridge.py:511)): una vela se invalida si
  (a) una posterior **cierra** fuera de tolerancia (`close > high+tol` / `close < low-tol`), o
  (b) **rango agotado**: las posteriores toman ambos extremos con sus **mechas**. Incluye la vela
  en formación como evaluadora.
- **Tolerancia por par** ([L167]): EURUSD 2.5 pips, GBPUSD 3.0 pips.
- **Acumulación** `is_accumulation_candle` ([crt_logic.py:266](crt_logic.py:266)): cuerpo ≤ 50% del
  rango **y** rango ≤ ATR×1.5 **y** volumen ≥ media (constantes fijas, sin UI). El ATR sale de
  `get_current_atr` (devuelve **pips**, se multiplica por `pip_value`); el volumen es `tick_volume`
  ya presente en las velas (sin llamadas extra).
- **Bias** `_compute_range_bias` ([~mt5_bridge.py:546](mt5_bridge.py:546)): high tomado → SELL,
  low tomado → BUY; gana el último extremo; el precio actual tiene la última palabra.
- Difunde `anchor_update` con `high/low/eq/anchor_time/bias/accumulation` solo si cambió ([L664]).

### 2.2 Rango D1 — `emit_daily_range` ([mt5_bridge.py:650](mt5_bridge.py:650))

Recorre 15 velas D1 cerradas (salta la en formación con `start_pos=1`) y elige la más reciente que
cumple **dos** condiciones ([L677-710]):
1. **Contención estricta**: `low ≤ bid ≤ high` (salta las que no contienen el precio).
2. **No superada por el CUERPO** de velas cerradas posteriores (`body_top > high` / `body_bot < low`).

Bias D1 incluye la vela D1 en formación. Difunde `daily_range`.

> **Nota honesta:** D1 usa **contención estricta + ruptura por cuerpo**; H4 usa **contención ±tol +
> ruptura por mecha/tolerancia + acumulación**. Son metodologías diferentes para "el mismo"
> concepto de rango. Ver §9.

---

## 3. El scanner (`strategy_scanner_task`) — bucle 1 Hz

Orden real de compuertas antes de evaluar un símbolo ([L877-913]):
1. `_backtest_running` → pausa.
2. `MT5_INITIALIZED and not RISK_GUARD_TRIGGERED`.
3. `update_reference_ranges()` (recalcula rangos cada ciclo).
4. `max_positions` global ([L887]): si hay ≥ N posiciones abiertas, no opera.
5. `BOT_ACTIVE` (sincronizado con la web).
6. `is_in_active_killzone()` ([L898]): fuera de killzone, no opera.
7. Por símbolo: si ya hay posición abierta en ese par → salta ([L906]).
8. **Cooldown 180 s** desde la última orden autónoma del par ([L912]).

---

## 4. Detección y confirmación del barrido

### 4.1 Detección (live)
`bid > crt_high` → **SELL**; `ask < crt_low` → **BUY** ([L966-971]). Se emite señal `DETECTED`
(throttle 60 s).

### 4.2 Confirmación de UNA vela (turtle soup) — recién corregida
Controlada por el flag `require_candle_confirmation`.
- **Registro** ([L998-1009]): guarda el `time` de la **vela en formación** (`rates_m1[-1]`), que es
  la que está barriendo el nivel, + dirección + crt_high/crt_low + timestamp.
- **Confirmación** ([L930-968]): espera a que esa vela **cierre** (`rates_m1[-1]["time"] >
  sweep_time`), la localiza por su `time` en un buffer de 5 velas M1, y la evalúa como **una sola
  vela** con `classify_sweep_type(sweep_candle, sweep_candle, …)`:
  - cierra de vuelta dentro del rango → **CONFIRMADO** (TBS/TWS),
  - cierra fuera → `INVALID` (breakout real, se descarta limpio),
  - timeout 180 s.
- `sweep_vela_2 = sweep_candle` → el SL dinámico se coloca detrás de la mecha correcta.

> Esto **corrige** el bug que descartaba el 100% de los sweeps (antes leía `rates_m1[0]` = la vela
> cerrada *anterior* al barrido, nunca la que barre). Implementado y compila; **pendiente de
> verificación con trades reales en MT5**.

### 4.3 Clasificación TBS/TWS — `classify_sweep_type` ([crt_logic.py:211](crt_logic.py:211))
Requiere `mecha_cruza` (la mecha rebasó el nivel) **y** `v3_recupera` (cierre de vuelta dentro);
si no, `INVALID`. Distingue según `body_ratio` (<20% = cuerpo limpio) y si el cuerpo abrió fuera:
- TBS conf 1.0 / 0.65 (cuerpo cruzó), TWS conf 0.75 / 0.50 (solo mecha).

> Si `require_candle_confirmation` está **desactivado**, NO hay confirmación: el bot entra al
> instante sobre el sweep en vivo, con `sweep_type=None` (sin TBS/TWS, sin multiplicador, sin SL
> dinámico por mecha). En la config del usuario hoy el flag está **activo**.

---

## 5. Filtros Capa 1 y SMT

### 5.1 `validate_hard_rules` (versión inline, la que se usa) ([mt5_bridge.py:320](mt5_bridge.py:320))
Llamada con 4 args ([L1035]). Lee `config_crt.json`, usa hora **Atlantic/Canary**. Valida en orden:
1. **Horario**: killzones dinámicas + `nine_am_model_cycle`.
2. **Spread**: `spread_pips ≤ ratio×ATR` (ratio 0.20) **y** `≤ max_spread_points`. Bypass disponible.
3. **ATR M1**: `≥ min_atr_pips` (12). Bypass.
4. **Mecha/cuerpo**: cuerpo ≤ `max_wick_body_ratio`% del rango, evaluado sobre `copy_rates(M1,0,1)`
   (la vela en formación). Bypass.
5. **Dimensión**: Forex amplitud ≥ 0.08% del precio; Índices ≥ 20 puntos. Bypass.

### 5.2 SMT Divergence ([L1052-1073], flag `smt_divergence_enabled`)
Compara el par con su correlacionado (EURUSD↔GBPUSD): solo continúa si el primario barrió y el
correlacionado **no** (divergencia institucional). `check_smt_divergence` en [crt_logic.py:241](crt_logic.py:241).

---

## 6. Ejecución y gestión

- **SL/TP base** ([L1108-1116]): pips fijos de `BotConfig` (`stop_loss_pips`, `take_profit_pips`).
- **SL dinámico** ([L1118-1126], flag `use_dynamic_sl`): detrás de la mecha de la vela de barrido +
  1.5 pips de buffer (`calculate_dynamic_sl`). Solo se aplica si mejora el SL base.
- **Targets CRT** ([L1128-1133], flag `use_crt_targets`): TP2 = extremo opuesto, TP1 = EQ (50%),
  guardado en `_crt_eq_target` para el cierre parcial.
- **Multiplicador de lote** ([L1135-1142]): ×`model_tbs_risk_multiplier` (1.0) o ×`model_tws_risk_multiplier` (0.5) según TBS/TWS.
- **Envío** `try_order_send` ([L1385](mt5_bridge.py:1385)): prueba filling modes FOK/IOC/RETURN según
  lo que acepta el símbolo; `magic=234000`; comment enriquecido `CRT|sweep:..|conf:..|kz:..` ([L848]).

### 6.1 Cierre parcial en EQ + breakeven ([L1308-1334], flag `partial_close_at_eq`)
En `positions_broadcaster`: al tocar el EQ, cierra `partial_close_pct`% del volumen y mueve el **SL a
breakeven** (`price_open`). Deduplica por ticket con `_eq_done`.

---

## 7. ChromaDB (`context_engine.py`) — informativo

`validate_market_context` ([context_engine.py:163](context_engine.py:163)) clasifica el setup como
`NEW`/`WIN_MATCH`/`LOSS_MATCH` por similitud coseno, pero **siempre** retorna `"approved": True` y
**nunca** bloquea ni toca el lote. El Feedback Loop registra cada trade cerrado (deduplicado por
`deal.ticket`). Llamadas no bloqueantes vía `asyncio.to_thread`.

---

## 8. Risk Guard

Estado `RISK_GUARD_TRIGGERED` detiene el scanner. `panic_close_all_positions` ([L1422](mt5_bridge.py:1422))
cierra todo a mercado. Límites `max_daily_loss_pct` (4.5) y `max_total_loss_pct` (8.0) desde
`config_crt.json`.

---

## 9. Hallazgos técnicos, deuda y código muerto (sin maquillaje)

### 9.1 Código muerto
- **`crt_logic.py:validate_hard_rules`** ([crt_logic.py:79](crt_logic.py:79)): versión de 7 args con
  los 5 filtros. **No se importa** ([L34] solo trae 5 funciones) → **nunca se ejecuta**. La que se
  usa es la inline de `mt5_bridge.py` (4 args). Dos implementaciones casi gemelas que pueden divergir.
- **`get_anchor_candle_params` / `find_anchor_candle`** ([crt_logic.py:6-37](crt_logic.py:6)):
  selección de anclaje por **calendario** (horario Canary). Reemplazada por la selección estructural
  de `update_reference_ranges`; ya no se usa.
- **`is_in_active_killzone` / `check_sweep`** de `crt_logic.py`: el bridge tiene sus propias versiones;
  las de `crt_logic.py` no se importan.

### 9.2 Flags declarados que NO hacen nada
Se reciben desde el frontend (`BOT_CONFIG_UPDATE`) pero **nunca se leen** en la lógica:
- `trailing_stop` ([L57], set en [L1882]) — no hay trailing stop implementado.
- `hybrid_m1_m15_confluence` ([L62], set en [L1887]) — no hay confluencia M1/M15 implementada.
- `smt_divergence_check` ([L63], set en [L1888]) — **duplicado muerto**; el gate real usa
  `smt_divergence_enabled` ([L70]).

### 9.3 Inconsistencias reales
- **H4 vs D1** usan criterios distintos de contención (±tol vs estricto) y de ruptura
  (mecha+tolerancia vs cuerpo). No hay una definición única de "rango roto".
- **Símbolos**: el rango H4 se calcula hardcodeado para `["EURUSD","GBPUSD"]` ([L583]); D1 usa
  `ACTIVE_BOT_SYMBOLS`. Si se añade un símbolo, el H4 no lo cubriría.
- **Killzones evaluadas dos veces**: gate `is_in_active_killzone()` ([L898]) y dentro de
  `validate_hard_rules` ([L362]). Ambas en hora Canary, pero los rangos H4/D1 etiquetan en UTC →
  fuente potencial de confusión al leer logs.
- **Filtro mecha/cuerpo de Capa 1** evalúa `copy_rates(M1,0,1)` = la vela **en formación**
  (incompleta), no la vela de barrido ya confirmada.

### 9.4 Defaults conservadores
En `BotConfig` ([L66-70]) están en `False` por defecto: `require_candle_confirmation`,
`use_dynamic_sl`, `use_crt_targets`, `partial_close_at_eq`, `smt_divergence_enabled`. Es decir,
**sin activarlos desde la web**, el bot opera al sweep en vivo con SL/TP de pips fijos, sin
confirmación, sin TBS/TWS, sin SL por mecha, sin targets CRT ni cierre parcial. (En la config actual
del usuario, `require_candle_confirmation` está activo.)

---

## 10. Correcciones recientes (esta sesión)

1. **Selección de rango H4** — añadido gate de contención + desempate por acumulación + **fallback
   consciente de contención** (`first_contained`). Antes, con todas las velas rotas (tendencia),
   `closed[-1]` reelegía una vela que el precio ya había abandonado → rango obsoleto + sweep falso
   perpetuo. Caso real EURUSD bid=1.14392: antes elegía 22/06 13:00 (L=1.14475, fuera); ahora
   elige una vela que encierra el precio.
2. **Confirmación de barrido de UNA vela** — corregido el bug de índice `rates_m1[0]` → ahora usa la
   vela en formación que barre y la evalúa al cerrar.

Ambas compilan (`py_compile`). **Pendiente:** verificación con MT5 en vivo (logs `[H4-ANCHOR]`,
`sweep CONFIRMADO (1 vela)`, ejecución real).

---

## 11. Verificación recomendada (end-to-end, con MT5 abierto)

1. `python mt5_bridge.py` y `python verify_range_logic.py` en paralelo: comparar la vela H4 elegida;
   con el fix, el bot debe elegir una vela que **contiene el precio** cuando el script diagnóstico
   cae al fallback.
2. En killzone: confirmar la secuencia `sweep pendiente → sweep CONFIRMADO (1 vela): TBS/TWS →
   🚀 Operación ejecutada`, con SL detrás de la mecha y comment `CRT|sweep:..`.
3. Validar que ya **no** se repite `vela de barrido no cerró dentro del rango` en bucle sobre la
   misma vela.
4. Revisar (decisión de producto) si conviene: unificar criterio H4/D1, eliminar el código muerto de
   §9.1 y los flags inertes de §9.2, y parametrizar los símbolos del rango H4.
