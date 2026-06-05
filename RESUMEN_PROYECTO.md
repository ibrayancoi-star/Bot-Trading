# Documentación Técnica — Dashboard de Trading Híbrido CRT

## 💡 Idea Central del Proyecto

Plataforma de trading avanzada (tipo TradingView) con ejecución autónoma, analítica de mercado en tiempo real y un motor de inteligencia contextual en un solo entorno.

### Arquitectura General

| Capa | Tecnología | Responsabilidad |
|------|-----------|----------------|
| **Frontend** | Next.js + Lightweight Charts | Interfaz premium, gráficos reactivos, configuración del bot, panel de posiciones |
| **Backend/Bridge** | Python + `mt5_bridge.py` | Conexión nativa MT5, escáner CRT, ejecución de órdenes, Risk Guard |
| **Motor Contextual** | ChromaDB + SentenceTransformers | Validación semántica, aprendizaje por refuerzo de trades cerrados |

```
Frontend (Next.js)
    │  ws://127.0.0.1:8000
    ▼
mt5_bridge.py (WebSocket Server)  ◄──► MetaTrader 5 (terminal local)
    │
    ▼
context_engine.py (ChromaDB local)  ◄──► crt_rules_curated.md
    │
    ▼
config_crt.json (parámetros fijos)
```

---

## 📊 Estado Actual e Integración del Sistema

### Estado Actual del Proyecto
El proyecto se encuentra en una **fase funcional avanzada** (MVP operativo) con la arquitectura base fuertemente consolidada.
- El **Frontend** es totalmente interactivo, renderizando el mercado en vivo a 1Hz, permitiendo la configuración dinámica del bot y la gestión manual de operaciones (cierre, modificación de SL/TP).
- El **Backend (mt5_bridge.py)** está estable. Gestiona concurrentemente la conexión bidireccional por WebSocket con el frontend y la conexión local con el terminal de MetaTrader 5.
- La **Integración Semántica (ChromaDB)** está activa y el *feedback loop* registra automáticamente los trades ganadores y perdedores para generar reglas dinámicas de Capa 3.

### Funcionalidad Esperada vs. Estrategia
Según la lógica del código y la estrategia institucional diseñada (Candle Range Theory + Smart Money Concepts), el flujo funcional esperado es:
1. **Identificación de la Caja (Anclaje):** El bot debe enmarcar automáticamente los extremos (High/Low) de una vela H4 específica que sirve como el campo de batalla de la sesión.
2. **Detección de la Trampa (Sweep):** El precio M1 rompe (hace sweep) del máximo o mínimo de esa caja H4 engañando a los operadores retail.
3. **Validación Exhaustiva (Hard Rules):** El setup debe sobrevivir a un exigente escrutinio: debe ocurrir en una Killzone (horario institucional), el spread no debe ser abusivo, la volatilidad (ATR) debe ser suficiente, la vela M1 de rechazo debe mostrar mecha (no cuerpo envolvente) y la caja H4 debe ser lo suficientemente grande (Filtro de Dimensión).
4. **Filtro de IA (Sentido Común Institucional):** Si el contexto actual coincide con escenarios históricamente perdedores (registrados en ChromaDB) o quiebra reglas curatoriales del manual CRT, la señal es vetada (`DISMISSED`).
5. **Ejecución y Gestión (Risk Guard):** Al aprobar todas las capas, se dispara una orden a mercado en dirección contraria al sweep. Automáticamente se calculan el TP y SL. El sistema monitoriza constantemente el drawdown; si la equidad sufre un colapso grave (>4.5% o >8%), activa un botón de pánico global que cierra posiciones y detiene el bot.

### ¿Cómo está integrado todo?
La integración sigue un modelo de **Event-Driven Architecture (EDA)** reactivo:
- **MT5 a Python:** A través del paquete `MetaTrader5` oficial, un hilo (`tick_broadcaster`) extrae precios cada 100ms. Otro hilo (`strategy_scanner_task`) evalúa la estrategia a 1Hz. Un tercer hilo (`feedback_loop_task`) monitorea trades cerrados cada 5s para alimentar a la IA.
- **Python a Next.js (Frontend):** Se utiliza `websockets` en un hilo dedicado (puerto 8000). Envía eventos JSON (`tick`, `anchor_update`, `positions`, `history_update`, `signal_evaluation`).
- **Next.js a Zustand (Estado Global):** `mock-feed.ts` actúa como el "Controlador de Tráfico". Recibe los JSONs, normaliza los datos (para prevenir inconsistencias de diferentes brokers de MT5) y muta de forma inmutable el estado en `trading-store.ts`. 
- **Zustand a UI:** Gracias a las suscripciones atómicas y `React.memo`, componentes como el gráfico (Lightweight Charts), las tablas de posiciones y los controles de configuración se re-renderizan independientemente, soportando la alta frecuencia de actualizaciones sin degradar el rendimiento del navegador. Todo el estado de configuración y conexión sobrevive a recargas gracias a la persistencia en `localStorage`.

---

## 🤖 Motor CRT — Cómo Evalúa el Gráfico

El bot implementa la metodología **Candle Range Theory (CRT)** en 6 fases secuenciales ejecutadas a 1Hz por el escáner autónomo (`strategy_scanner_task`).

---

### FASE 1 — Selección de la Vela de Anclaje H4

**Código:** [`update_reference_ranges()`](mt5_bridge.py#L447)

El bot **no usa la vela H4 anterior genérica**. Selecciona una vela H4 **cerrada y específica** según un calendario de anclaje basado en la hora de Canarias (`Atlantic/Canary`):

| Hora actual (Canary) | Vela H4 que busca (inicio) | Etiqueta |
|---------------------|--------------------------|---------|
| 00:00 – 05:59 | 10:00 del **día anterior** | `14:00 Anchor` |
| 06:00 – 09:59 | 02:00 del mismo día | `06:00 Anchor` |
| 10:00 – 13:59 | 06:00 del mismo día | `10:00 Anchor` |
| 14:00 – 23:59 | 10:00 del mismo día | `14:00 Anchor` |

**Proceso interno:**
1. Descarga las últimas 10 velas H4 de MT5
2. Calcula el offset de hora del servidor del bróker respecto a UTC
3. Convierte la hora de apertura de cada vela a hora Canaria
4. Busca la que coincida con el inicio objetivo
5. **Fallback:** si no hay coincidencia exacta → usa `rates[1]` (la H4 cerrada más reciente)

> ⚠️ Si el bróker reporta timestamps incorrectos el offset se calcularía mal y la vela de anclaje sería errónea.

---

### FASE 2 — Cálculo de Rangos CRT

Una vez seleccionada la vela de anclaje se extraen 3 niveles de precio:

```
CRT High = float(vela['high'])
CRT Low  = float(vela['low'])
EQ       = CRT_Low + 0.5 × (CRT_High − CRT_Low)   ← Equilibrium / Midpoint
```

Estos valores se almacenan en `anchor_ranges` y se envían al frontend como líneas horizontales sobre el gráfico (`anchor_update`). Solo se actualizan si los valores cambian.

---

### FASE 3 — Detección del Barrido (Sweep)

**Código:** [`strategy_scanner_task()` L636-641](mt5_bridge.py#L636)

Comparación tick a tick (1Hz) del precio actual contra los extremos del rango H4:

```python
if bid > crt_high:      → direction = "SELL"   # Sweep del máximo → reversión bajista
elif ask < crt_low:     → direction = "BUY"    # Sweep del mínimo → reversión alcista
```

**Representación visual:**

```
  bid ──────────────────── ← SI bid > CRT_HIGH → SELL
CRT_H ══════════════════ ← Máximo de la vela H4 de anclaje
  EQ  ─ ─ ─ ─ ─ ─ ─ ─ ─ ← Equilibrium
CRT_L ══════════════════ ← Mínimo de la vela H4 de anclaje
  ask ──────────────────── ← SI ask < CRT_LOW → BUY
```

**Pre-filtros previos a evaluar el barrido:**

| Condición | Código |
|-----------|--------|
| Bot activo (`BOT_ACTIVE`) | L596 |
| Dentro de Killzone activa | L600 |
| Sin posición abierta en ese par | L608-610 |
| Cooldown 3 minutos tras última orden | L613-615 |
| Tick y symbol_info válidos | L618-621 |
| Rangos de anclaje inicializados | L629-630 |

> ⚠️ **Observación crítica:** El bot detecta el barrido con **un solo tick** que supere el nivel. No espera cierre de vela ni confirmación de mecha. Los modelos TBS/TWS están documentados en las reglas pero **no están implementados** en el scanner.

---

### FASE 4 — Filtros de Capa 1 (Hard Rules)

**Código:** [`validate_hard_rules()`](mt5_bridge.py#L264)

5 filtros secuenciales. Si cualquiera falla → señal `DISMISSED`. El anti-spam evita repetir el mismo rechazo más de 1 vez por minuto.

#### 4.1 Filtro de Horario

Verifica que la hora actual (en `Atlantic/Canary`) esté dentro de:

**A) Killzones dinámicas** (configurables desde el frontend):

| Killzone | Inicio | Fin | Activa por defecto |
|---------|--------|-----|-------------------|
| London | 07:00 | 10:00 | ✅ |
| New York | 12:00 | 15:00 | ❌ |
| Asian | 02:00 | 05:00 | ❌ |

**B) Nine AM Model Cycle** (definido en `config_crt.json`):

| Fase | Inicio | Fin |
|------|--------|-----|
| Acumulación | 14:00 | 14:30 |
| Manipulación | 14:30 | 15:00 |
| Distribución | 15:00 | 15:30 |

> ⚠️ **Inconsistencia detectada:** Existen dos validaciones de horario diferentes:
> - `is_in_active_killzone()` (pre-filtro, L600) → usa hora **UTC**
> - `validate_hard_rules()` (L296) → usa hora **Canary**
>
> Pueden dar resultados distintos para el mismo instante. El scanner pasa ambas en serie.

**Bypass:** ❌ No tiene.

---

#### 4.2 Filtro de Spread

```
spread_pips = current_spread_points / 10.0

Condición 1: spread_pips ≤ (0.20 × ltf_atr_M1)     ← ratio máximo del ATR
Condición 2: current_spread_points ≤ max_spread_points  ← límite absoluto en puntos
```

**Bypass:** ✅ `disable_spread_filter = True`

---

#### 4.3 Filtro de ATR Mínimo

```
ltf_atr = ATR(M1, período 14)   ← True Range clásico convertido a pips

SI ltf_atr < min_atr_pips → RECHAZAR
```

**Bypass:** ✅ `disable_atr_filter = True`

---

#### 4.4 Filtro de Ratio Mecha CRT

Evalúa la **última vela M1**, no la vela de anclaje H4:

```
candle_range = high − low
body_size    = |close − open|

SI body_size > candle_range × (max_wick_body_ratio / 100) → RECHAZAR
```

Un cuerpo M1 grande sugiere continuación (impulso), no reversión (trampa CRT).

**Bypass:** ✅ `disable_wick_body_filter = True`

---

#### 4.5 Filtro de Dimensión ⭐

Evalúa si el **rango de la vela H4 de anclaje** es suficientemente grande.

**Para Forex:**
```
range_size_pips = (crt_high − crt_low) / pip_value   ← amplitud del rango H4 en pips
range_precio    = range_size_pips × pip_value
amplitude_pct   = (range_precio / precio_bid_actual) × 100

SI amplitude_pct < 0.08% → RECHAZAR
```

Rangos mínimos aproximados por par:

| Par | Precio aprox. | Pips mínimos requeridos |
|-----|--------------|------------------------|
| EURUSD | 1.0800 | **~8.6 pips** |
| GBPUSD | 1.2700 | **~10.2 pips** |
| USDJPY | 155.00 | **~12.4 pips** |

**Para Índices:**
```
SI range_size_pips < 20.0 puntos → RECHAZAR
```

**Bypass:** ✅ `disableDimensionFilter = True` (y umbrales configurables dinámicamente)

> ⚠️ En `config_crt.json` también existe `atr_filter.min_body_to_atr_ratio: 0.10` dentro de `dimension_restrictions`, pero ese sub-filtro **no está implementado** en el código.

---

### FASE 5 — Validación Semántica Capa 2/3 (ChromaDB)

**Código:** [`validate_market_context()`](context_engine.py#L94)

Si la Capa 1 aprueba, se construye una consulta semántica:

```python
query = f"Setup: Sweep High Reversal (SELL). Market Context: Symbol: EURUSD, Price: 1.08550, ..."
```

Se buscan los `top_k` fragmentos más similares en la colección `crt_knowledge` de ChromaDB. Si alguno tiene:
- **Distancia < `chroma_threshold`** (default: 0.72)
- **Y** es `capa_3_exclusion` **o** contiene "invalida", "prohibido", "cancelar"

→ la señal se bloquea.

**Fuentes de conocimiento en la base vectorial:**

| Fuente | Tipo | Cuándo se carga |
|--------|------|----------------|
| `crt_rules_curated.md` | Estática | Al arranque del bridge |
| Trades cerrados (LOSS) | `capa_3_exclusion` | Automático cada 5s (feedback loop) |
| Trades cerrados (PROFIT) | `capa_2_semantica` | Automático cada 5s (feedback loop) |

Esto crea un **aprendizaje por refuerzo negativo**: un trade perdedor bloquea setups similares en el futuro.

---

### FASE 6 — Ejecución y Gestión Post-Trade

**Cálculo de SL y TP:**
```python
# SELL (sweep del high)
sl_price = price + sl_pips × pip_value
tp_price = price − tp_pips × pip_value

# BUY (sweep del low)
sl_price = price − sl_pips × pip_value
tp_price = price + tp_pips × pip_value
```

La orden se envía con `try_order_send()` que prueba 3 modos de filling en orden: `IOC → FOK → RETURN`.

Tras ejecutar, se activa un **cooldown de 3 minutos** por símbolo para evitar sobreoperación.

**Feedback Loop** (`feedback_loop_task`, cada 5s):
1. Consulta deals cerrados en la última hora en MT5
2. Calcula pips resultado y clasifica `PROFIT` / `LOSS`
3. Registra en ChromaDB con metadata semántica
4. Emite `history_update` al frontend

**Risk Guard** (evaluado a 10Hz en `tick_broadcaster`):
```
drawdown = balance_inicial_del_día − equity_actual

SI drawdown ≥ 4.5% del balance → Cierre de pánico + bloqueo total
SI drawdown ≥ 8.0% del balance → Cierre de pánico + bloqueo total
```

---

## ⚙️ Mapa Completo de Parámetros Ajustables

### Desde el Frontend (vía WebSocket `BOT_CONFIG_UPDATE`)

| Parámetro | Campo WebSocket | Default | Bypass disponible |
|-----------|----------------|---------|------------------|
| Lotaje | `lotSize` | 0.1 | — |
| Take Profit | `takeProfitPips` | 20 | — |
| Stop Loss | `stopLossPips` | 15 | — |
| Máx posiciones | `maxPositions` | 3 | — |
| Killzones activas | `killzones` | London + Overlap | — |
| Horario London | `londonStart` / `londonEnd` | 07:00-10:00 | — |
| Horario NY | `newYorkStart` / `newYorkEnd` | 12:00-15:00 | — |
| Horario Asian | `asianStart` / `asianEnd` | 02:00-05:00 | — |
| Spread máx (puntos) | `maxSpreadPoints` | 20.0 | `disableSpreadFilter` |
| ATR mínimo (pips) | `minAtrPips` | 12.0 | `disableAtrFilter` |
| Ratio mecha máx (%) | `maxWickBodyRatio` | 20.0 | `disableWickBodyFilter` |
| Bypass Dimensión | `disableDimensionFilter` | false | — |
| Dimensión Forex mín % | `minAmplitudeForexPct` | 0.08 | — |
| Dimensión Índices pts | `minAmplitudeIndicesPoints` | 20.0 | — |
| Umbral ChromaDB | `chromaThreshold` | 0.72 | — |
| Top-K ChromaDB | `chromaTopK` | 5 | — |
| Trailing Stop | `trailingStop` | false | — |
| Cierre parcial | `partialClose` | false | — |
| % cierre parcial | `partialClosePct` | 50 | — |
| Multiplicador TBS | `modelTbsRiskMultiplier` | 1.0 | — |
| Multiplicador TWS | `modelTwsRiskMultiplier` | 0.5 | — |
| Confluencia M1/M15 | `hybridM1M15Confluence` | true | — |
| Check SMT | `smtDivergenceCheck` | true | — |

### Desde `config_crt.json` (leído en cada evaluación de Capa 1)

| Parámetro | Ruta JSON | Default |
|-----------|-----------|---------|
| Timezone | `capa_1_hard_rules.timezone` | `Atlantic/Canary` |
| Spread ratio máx | `spread_threshold.max_spread_to_ltf_atr_ratio` | 0.20 |
| Nine AM cycle | `nine_am_model_cycle.*` | Habilitado |
| Max daily loss % | `risk_management.max_daily_loss_pct` | 4.5 |
| Max total loss % | `risk_management.max_total_loss_pct` | 8.0 |

---

## 🚧 Funcionalidades Definidas pero NO Implementadas

> Los siguientes parámetros están definidos en `BotConfig` o en las reglas, pero no tienen lógica activa en el scanner:

| Funcionalidad | Dónde se define | Estado |
|---------------|----------------|--------|
| **TBS (Turtle Body Soup)** — cierre fuera/dentro del rango | `crt_rules_curated.md` L30 | ❌ No implementado |
| **TWS (Turtle Wick Soup)** — mecha de rechazo ≥50% | `crt_rules_curated.md` L31 | ❌ No implementado |
| **Trailing Stop** | `BotConfig.trailing_stop` | ❌ Se guarda, no se usa |
| **Cierre parcial en EQ** | `BotConfig.partial_close` | ❌ Se guarda, no se usa |
| **Confluencia M1/M15** | `BotConfig.hybrid_m1_m15_confluence` | ❌ Se guarda, no se usa |
| **SMT Divergence Check** | `BotConfig.smt_divergence_check` | ❌ Se guarda, no se usa |
| **Multiplicadores TBS/TWS** | `BotConfig.model_tbs/tws_risk_multiplier` | ❌ Se guardan, no se usan |
| **ATR body ratio** | `config_crt.json → min_body_to_atr_ratio` | ❌ Definido en JSON, no evaluado |
| **Max posiciones (límite real)** | `BotConfig.max_positions = 3` | ❌ El scanner solo comprueba `> 0` |

---

## 🧠 Decisiones de Arquitectura

### 1. Metodología CRT Institucional
Se extendió el modal de configuración y el bridge de Python para incorporar multiplicadores de riesgo (TBS/TWS) y confluencias avanzadas (Híbrida M1/M15, Divergencia SMT), permitiendo ajustar la agresividad del bot sin tocar el código fuente del motor.

### 2. Interfaz de Configuración como Modal Independiente
La configuración del bot es una ventana modal flotante arrastrable en lugar de un panel lateral. Maximiza el área del gráfico y mantiene aspecto premium permitiendo cerrarlo sin alterar el layout principal.

### 3. Estructura HMR-Safe con Persistencia en `window`
El socket activo, las flags de suscripción y las variables clave de Zustand (`botConfig`, `isBotActive`, `botActiveSymbols`) se persisten en `localStorage` y se gestionan en el objeto global `window`. Esto resuelve la fuga de conexiones WebSocket y la duplicidad de callbacks generada por los refrescos en caliente de Next.js (HMR).

### 4. Sistema de Bypass Dinámico de Capa 1
Se implementó un sistema de flags (`disable_spread_filter`, `disable_atr_filter`, `disable_wick_body_filter`, `disable_dimension_filter`) controlables desde el frontend para poder flexibilizar las hard rules sin modificar el código del motor, útil en backtesting manual o en condiciones de mercado atípicas.

---

## ✅ Resumen Técnico: Implementaciones Recientes y Corrección de Bugs

En las últimas iteraciones se ha mejorado sustancialmente el manejo de la información en vivo, la robustez de la aplicación y se ha implementado el entorno de simulación.

### 🚀 ¿Qué se implementó?

1. **Motor de Backtesting y Entorno de Simulación AISLADO:**
   - **Backend:** Se creó `backtesting_engine.py` para procesar el histórico de MT5, simular ticks basados en datos reales e inyectar un feed acelerado y controlado por el usuario, sin afectar al entorno live.
   - **Frontend:** Implementación de vistas completas de Backtesting en Next.js (`BacktestPanel`, `BacktestChart`, `EquityCurveChart`, `MetricsPanel`, `TradeLog`).
   - **Estado:** Se añadió `backtest-store.ts` para aislar los datos simulados de las operaciones reales.
   - **Arquitectura UI:** Inclusión de un modo triple (`DEMO`, `BACKTEST`, `LIVE`) desde el `Header.tsx` gestionado por un nuevo `useModeStore`.
   - **Integración:** El socket principal ahora enruta mensajes con prefijo `backtest_` a los handlers específicos sin contaminar los módulos de feed real (`mock-feed.ts`).

2. **Bypass del Filtro de Dimensión (Capa 1):**
   - **Problema:** El filtro de dimensión (que valida el tamaño mínimo de la vela H4) leía directamente desde `config_crt.json` y era el único filtro inflexible.
   - **Solución:** Se integró la configuración dentro de `BotConfig` para controlarse desde el UI. Se añadieron switches y deslizadores numéricos en `LeftSidebar.tsx` para ignorar la regla o alterar los umbrales dinámicamente (`minAmplitudeForexPct` y `minAmplitudeIndicesPoints`). Se modificó el motor en Python (`mt5_bridge.py`) para utilizar un `threading.Lock()` de lectura segura y tomar estos valores en caliente.

3. **Módulo de Posiciones en Vivo e Historial Interactivo:**
   - **Reconstrucción del Panel Inferior:** Se eliminaron las tablas genéricas previas y se desarrollaron tablas dedicadas (`PositionsTable`, `HistoryTable`) e integradas en `BottomPanel.tsx`.
   - **Gestión Avanzada del Estado:** Se crearon interfaces estrictas (`Position`, `ClosedTrade`) y se extendió Zustand (`trading-store.ts`) con nuevas acciones sin interferir en el código preexistente.
   - **Interactividad Bidireccional:** Ahora los usuarios pueden cerrar posiciones o modificar parámetros de Stop Loss (SL) y Take Profit (TP) en tiempo real usando un modal integrado (`ModifySLTPModal`).
   - **Optimización de Renderizado:** Se aplicó `React.memo` con comparadores explícitos a nivel de fila (`PositionRow`, `HistoryRow`) y animaciones CSS controladas por `useRef` en las celdas de PnL. Esto garantiza que un flujo de WebSocket a 1Hz no cause tirones de rendimiento en toda la aplicación.

### 🐛 ¿Qué errores se corrigieron?

1. **Desincronización de WebSocket al cambiar de modo (Bug 1):**
   - **Síntoma:** Cambio entre modos Live/Backtest provocaba inestabilidad de red y reconexiones infinitas.
   - **Causa:** El unmount/remount de componentes re-ejecutaba hooks conectados al singleton del WebSocket.
   - **Fix:** Refactorización de `page.tsx` para usar renderizado condicional persistente y estabilización de la conexión principal con MT5 mediante CSS visibility y memoización del socket global.

2. **Pérdida de Configuración en Modo Borrador (Bug 2):**
   - **Síntoma:** Al configurar parámetros en el `LeftSidebar` y pulsar F5 antes de aplicar, los cambios o la configuración guardada no se respetaban.
   - **Causa:** El estado local de React se iniciaba antes de que el store persistente de Zustand (`trading-store.ts`) terminase de hidratar el localStorage.
   - **Fix:** Integración de validadores de hidratación en la inicialización de los componentes de configuración para que el *draft state* tome los valores correctos de la persistencia de forma asíncrona.

3. **Crash en el Parseo de Historial (mock-feed.ts):**
   - **Síntoma:** Error `Cannot read properties of undefined (reading 'toLowerCase')`.
   - **Causa:** El puente de Python enviaba campos de configuración con nombres variables para cada broker (e.g. `order_type` vs `type`).
   - **Fix:** Se introdujo parseo defensivo empleando *nullish coalescing operators* para interceptar y normalizar el payload antes de volcarlo en Zustand: `t.type ?? t.order_type ?? "buy"`.

4. **Assertion Error en Gráficos (PriceChart.tsx):**
   - **Síntoma:** Error `the type of 'price' price line's property must be a number, got 'undefined'`.
   - **Causa:** Lightweight Charts intentaba dibujar la línea de entrada de un trade utilizando `pos.entryPrice`, un campo que llegaba nulo ya que MT5 emitía el campo como `open_price`.
   - **Fix:** Refactorización segura en el bucle que pinta las líneas, agregando guards `if (!pos.open_price && !pos.entryPrice) return;` y un mapeo de fallbacks en caliente para todos los campos críticos (precio, volumen, type, id).

5. **Inestabilidad de Keys y Valores en HistoryTable/HistoryRow:**
   - **Síntoma:** Warnings de React por keys duplicadas (`undefined-178...`) y crash runtime por llamadas a `.toFixed()` sobre valores nulos.
   - **Fix:** Implementación de claves reactivas seguras `key={`${t.ticket ?? t.id}-${t.close_time ?? Math.random()}`}` y creación del helper global `safeNum(val, decimals)` para sanear matemáticamente cualquier celda en la tabla.

---

## ✅ Implementaciones Antiguas (Histórico)

- Frontend reactivo Next.js + Lightweight Charts
- Puente asíncrono WebSocket con MetaTrader 5 (`mt5_bridge.py`)
- Motor de escáner autónomo CRT con detección de sweeps H4
- Sistema de velas de anclaje H4 por calendario de hora Canaria
- Integración ChromaDB + SentenceTransformers (modelo `all-MiniLM-L6-v2`)
- Feedback loop de aprendizaje automático por trades cerrados
- Risk Guard System (drawdown diario + total) con cierre de pánico
- Modal de configuración CRT completo con todos los parámetros del bot
- Resolución de bucles de eco y fugas de conexión WebSocket (HMR-Safe)
- Resolución de símbolo del bróker con caché (sufijos tipo `.ecn`)

---

## 🎯 Pendiente / Próximos Pasos

1. **Implementar TBS/TWS real:** El modelo de barrido actual es básico (un tick). Implementar la confirmación de cierre de vela dentro/fuera del rango para TBS, y la validación de mecha de rechazo ≥50% para TWS.
2. **Activar funcionalidades fantasma:** Trailing stop, cierre parcial en EQ, confluencia M1/M15, SMT divergence y max_positions reales.
3. **Unificar validación de horario:** Resolver la inconsistencia entre `is_in_active_killzone()` (UTC) y `validate_hard_rules()` (Canary).
