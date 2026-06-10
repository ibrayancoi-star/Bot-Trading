# Documentación Técnica — Dashboard de Trading Híbrido CRT

> **Última actualización:** 2026-06-09 · **Versión del documento:** v2.0
>
> Leyenda de estado: ✅ IMPLEMENTADO · 🔶 PARCIAL · ❌ PENDIENTE

### Stack Tecnológico

| Capa | Tecnologías |
|------|-------------|
| **Frontend** | Next.js 16, TypeScript, Zustand, Lightweight Charts, Tailwind CSS |
| **Backend/Bridge** | Python 3.x, paquete `MetaTrader5`, `websockets`, `asyncio`, `pytz` |
| **Motor Contextual** | ChromaDB, SentenceTransformers (`all-MiniLM-L6-v2`) |

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

## 🔀 Sistema de Modos Operativos

El proyecto opera en **tres modos mutuamente excluyentes** gestionados por `useModeStore` (Zustand):

```typescript
export type DashboardMode = "DEMO" | "BACKTEST" | "LIVE";
```

El usuario alterna entre modos desde el **Header** mediante tres botones pill con colores semánticos:
- **DEMO** → `bg-tv-blue` (azul)
- **BACKTEST** → `bg-purple-600` (púrpura)
- **LIVE** → `bg-rose-600` (rojo)

> El cambio de modo **no destruye componentes**. Se usa `className="hidden"` / CSS visibility para mantener las instancias de WebSocket y gráficos vivas evitando reconexiones destructivas (lección del Bug 1).

---

## 🟦 MODO DEMO — Simulación Visual sin Riesgo

### Propósito
Permitir al usuario explorar la interfaz completa, visualizar el mercado en vivo, configurar parámetros del bot y familiarizarse con la plataforma **sin ejecutar operaciones reales** ni conectar con una cuenta de trading real.

### Cómo Funciona Técnicamente

#### Flujo de Datos
```
MT5 (datos de mercado) ──► mt5_bridge.py ──ws──► mock-feed.ts ──► trading-store.ts ──► UI
                                                     │
                                                     └── Normaliza payloads de diferentes brokers
                                                         con nullish coalescing defensivo
```

1. **Conexión WebSocket:** El frontend se conecta al bridge Python en `ws://127.0.0.1:8000`. El `tick_broadcaster` del bridge emite datos de precio cada 100ms.
2. **Recepción y normalización:** `mock-feed.ts` actúa como controlador de tráfico. Recibe JSONs (`tick`, `anchor_update`, `positions`, `signal_evaluation`) y los normaliza para prevenir inconsistencias de brokers distintos.
3. **Estado Global:** Los datos normalizados mutan inmutablemente el estado en `trading-store.ts` (Zustand con persistencia en `localStorage`).
4. **Renderizado:** `PriceChart` (Lightweight Charts), tablas de posiciones y controles de configuración se re-renderizan independientemente gracias a suscripciones atómicas de Zustand + `React.memo`.

#### Bot en Modo DEMO
- El escáner CRT (`strategy_scanner_task`) **sí evalúa señales** (detecta sweeps, valida hard rules, consulta ChromaDB).
- Las señales se envían al frontend como eventos `signal_evaluation` para que el usuario vea qué habría pasado.
- **NO ejecuta órdenes.** El flag `BOT_ACTIVE` controla si se dispara `try_order_send()`.
- El usuario puede activar/desactivar el bot desde el `LeftSidebar`, pero en modo DEMO esta activación es visual (el motor evalúa pero no opera).

### Qué se Aprecia en la Interfaz

| Elemento UI | Componente | Qué muestra |
|-------------|-----------|-------------|
| **Gráfico de velas** | `PriceChart.tsx` | Velas M1/M5/M15/H1/H4 en tiempo real con Lightweight Charts. Incluye líneas horizontales de CRT (High, Low, Equilibrium) |
| **Indicadores técnicos** | `IndicatorMenu.tsx` / `IndicatorSettingsDialog.tsx` | EMA 9/21, RSI, MACD superpuestos al gráfico. Configurables en período y estilo |
| **Selector de símbolo** | `SymbolSelector.tsx` | Dropdown para cambiar par de divisas/índice activo |
| **Selector de temporalidad** | `TimeframeSelector.tsx` | Botones de temporalidad (1m, 5m, 15m, 1h, 4h) |
| **Panel de configuración CRT** | `LeftSidebar.tsx` (modal flotante arrastrable) | Todos los parámetros del bot: lotaje, TP/SL, killzones, filtros con bypass, umbrales ChromaDB, multiplicadores TBS/TWS |
| **Estadísticas de cuenta** | `AccountStats.tsx` | Balance, equity, drawdown diario y total con barras de progreso visuales y badge de estado |
| **Panel de posiciones** | `PositionsTable.tsx` | Tabla de posiciones abiertas (vacía en DEMO puro) con PnL flotante en tiempo real |
| **Historial de trades** | `HistoryPanel.tsx` | Historial de operaciones cerradas con análisis del Feedback Loop expandible (ChromaDB insights) |
| **Barra de conexión MT5** | `Header.tsx` | Indicador de estado: verde pulsante (Activo), amarillo (Conectando), rojo (Inactivo) con login/servidor |
| **Panel derecho** | `RightSidebar.tsx` | Watchlist de símbolos y resumen de mercado |
| **Panel inferior** | `BottomPanel.tsx` | Posiciones + Historial en pestañas |
| **Notificaciones de trade** | `TradeNotifications.tsx` | Toasts animados cuando el bot evalúa o ejecuta señales |

### Estado Actual: ✅ Funcional
- El modo DEMO está operativo. Es el **modo por defecto** al arrancar (`mode: "DEMO"` en el store).
- La interfaz completa se renderiza, el gráfico recibe datos en vivo, y las evaluaciones del scanner se visualizan.

### Pendiente en DEMO
| Funcionalidad | Estado | Detalle |
|---------------|--------|---------|
| Señales fantasma en el gráfico | ❌ No implementado | Dibujar marcadores donde el bot *habría* operado sin riesgo real |
| Panel de evaluación CRT visual | ❌ No implementado | Mostrar en tiempo real las 6 fases de evaluación con semáforo (✅/❌ por cada filtro) |
| Replay de sesiones pasadas | ❌ No implementado | Cargar datos históricos y reproducir la sesión como si fuera en vivo |

---

## 🟪 MODO BACKTEST — Simulación Histórica Controlada

### Propósito
Evaluar la estrategia CRT sobre datos históricos de MT5 con un motor de simulación independiente, calculando métricas de rendimiento (Win Rate, Profit Factor, Max Drawdown, Sharpe Ratio) sin riesgo alguno.

### Cómo Funciona Técnicamente

#### Arquitectura del Backtesting
```
BacktestPanel.tsx (UI)
    │ startBacktest({ symbol, timeframe, from, to, config })
    ▼
backtest-feed.ts ──ws──► mt5_bridge.py
    │                        │
    │                        ▼
    │                  backtesting_engine.py
    │                        │
    │                  ┌─────┴──────────────┐
    │                  │  DataLayer          │ ← Fetch histórico de MT5
    │                  │  SimEngine.run()    │ ← Loop vela-a-vela
    │                  │  ResultsStreamer    │ ← Métricas + Markdown log
    │                  └─────┬──────────────┘
    │                        │
    │    ◄──ws── mensajes prefijados "backtest_"
    ▼
backtest-store.ts (Zustand aislado)
    │
    ▼
BacktestChart / MetricsPanel / EquityCurveChart / TradeLog
```

#### Flujo Detallado

1. **Configuración (Frontend):** El usuario selecciona en `BacktestPanel.tsx`:
   - Símbolo (EURUSD, GBPUSD)
   - Temporalidad (1m, 5m, 15m, 1h, 4h)
   - Rango de fechas (desde / hasta)
   - Parámetros del bot (lotaje, TP/SL, umbral ChromaDB, killzones, filtros bypass)

2. **Lanzamiento:** `startBacktest()` en `backtest-feed.ts` envía un mensaje WebSocket al bridge.

3. **Obtención de datos:** `DataLayer.get_historical_data()` descarga velas del rango solicitado de MT5 usando `mt5.copy_rates_range()`. También descarga velas H4 extendidas (5 días antes del rango) para el cálculo de anclaje.

4. **Motor de simulación (`SimEngine.run()`):** Loop secuencial sobre cada vela del DataFrame:
   - **Indicadores:** Calcula EMA(9), EMA(21), RSI(14), MACD(12,26,9), ATR(14) sobre una ventana deslizante de 150 velas.
   - **Anclaje H4:** Usa `get_anchor_candle_params()` y `find_anchor_candle()` del módulo `crt_logic.py` (las mismas funciones que el scanner live).
   - **Detección de sweep:** `check_sweep()` compara precio contra CRT High/Low.
   - **Validación Capa 1:** `validate_hard_rules()` aplica los 5 filtros secuenciales (horario, spread, ATR, mecha, dimensión) con la config recibida.
   - **Validación ChromaDB:** `validate_market_context()` con retry de hasta 3 intentos y sleep de 1s entre fallos.
   - **Gestión de posiciones:** Evalúa SL/TP hit contra high/low de cada vela.
   - **Cálculo de equity flotante:** En cada vela recalcula PnL flotante.
   - **Streaming:** Emite mensajes `backtest_candle`, `backtest_trade`, `backtest_equity`, `backtest_progress` vía WebSocket.

5. **Enrutamiento de mensajes:** El socket principal detecta el prefijo `backtest_` y enruta al `backtest-store.ts` sin contaminar el `trading-store.ts` (datos live).

6. **Finalización:** `ResultsStreamer.calculate_metrics()` calcula métricas y `write_markdown_log()` genera un reporte `.md` en `backtest_logs/`.

#### Cálculo de Métricas (`ResultsStreamer`)

| Métrica | Fórmula |
|---------|---------|
| **Win Rate** | `(trades_ganadores / total_trades) × 100` |
| **Profit Factor** | `gross_profit / gross_loss` (≥1.5 = bueno) |
| **Max Drawdown** | `max((peak - equity) / peak × 100)` sobre toda la curva |
| **Sharpe Ratio** | `(avg_return / std_return) × √252` (simplificado, anualizado) |
| **Trades sin ChromaDB** | Cuenta de trades donde ChromaDB falló (3 reintentos agotados) |

### Qué se Aprecia en la Interfaz

| Elemento UI | Componente | Qué muestra |
|-------------|-----------|-------------|
| **Panel de parámetros (izq)** | `BacktestPanel.tsx` | Selector de símbolo, temporalidad, rango de fechas, lotaje, TP/SL, umbral ChromaDB. Botones INICIAR/DETENER/LIMPIAR |
| **Barra de progreso** | `BacktestPanel.tsx` | Barra animada con conteo vela actual / total. Aparece solo durante ejecución |
| **Gráfico de velas simulado** | `BacktestChart.tsx` | Lightweight Charts renderizando velas históricas con marcadores de trades (flechas de entrada/salida) |
| **KPIs en tarjetas** | `MetricsPanel.tsx` | 5 tarjetas: Win Rate, Profit Factor, Max Drawdown, Sharpe Ratio, Total Trades. Con coloreado semántico (verde ≥ umbral, rojo < umbral) |
| **Curva de Equity (SVG)** | `EquityCurveChart.tsx` | Gráfico SVG con gradiente de área bajo la línea. Muestra balance actual, máximo y mínimo dinámicos. Líneas de grid punteadas |
| **Registro de operaciones** | `TradeLog.tsx` | Tabla scrolleable con cada trade: tipo, precio entrada/salida, PnL, estado ChromaDB (✅/⚠️), razón de aprobación/rechazo |
| **Exportar resultados** | `BacktestExport.tsx` | Botón para descargar las métricas y operaciones |
| **Mensaje de error** | `BacktestPanel.tsx` | Caja roja con detalle del error si `status === "error"` |

> **Nota de Layout:** En modo BACKTEST, el `LeftSidebar` estándar, `RightSidebar`, y `BottomPanel` se ocultan (`hidden`). Se reemplaza el sidebar izquierdo por `BacktestPanel` y el área central muestra `BacktestChart` + panel inferior con métricas.

### Estado Actual: ✅ Funcional (MVP)

El motor de backtesting está operativo. Descarga datos de MT5, simula el scanner CRT completo incluyendo validación ChromaDB, genera métricas y reportes Markdown, y renderiza resultados en el frontend.

### Pendiente en BACKTEST
| Funcionalidad | Estado | Detalle |
|---------------|--------|---------|
| Optimizador de parámetros (Grid Search) | 🔶 Backend listo, sin UI | `optimizer.py` implementa `grid_search()` con combinaciones de TP/SL/lotaje. Usa `SimEngine` simplificado sin ChromaDB. Falta panel de UI para configurar la grilla y visualizar resultados |
| Heatmap de resultados | ❌ No implementado | Visualizar resultados del Grid Search como mapa de calor TP vs SL con color = Profit Factor |
| Walk-forward analysis | ❌ No implementado | Dividir datos en ventanas in-sample/out-sample para validar robustez |
| Multi-símbolo simultáneo | ❌ No implementado | Ejecutar backtest en paralelo sobre múltiples pares |
| Comparación de configuraciones | ❌ No implementado | Overlay de curvas de equity de diferentes runs para comparar lado a lado |
| Velocidad de reproducción ajustable | ❌ No implementado | El delay actual es fijo (`asyncio.sleep(0.005)`). Falta slider de velocidad en UI (1x, 10x, 100x, máxima) |
| Deslizamiento y comisiones | ❌ No implementado | El motor no simula slippage ni comisiones del broker. Spread se mockea a 15 puntos fijos |

---

## 🟥 MODO LIVE — Ejecución Real con Dinero

### Propósito
Ejecutar la estrategia CRT de forma autónoma sobre una cuenta real (o demo) de MetaTrader 5, abriendo y cerrando posiciones con dinero real, con protecciones de riesgo activas.

### Cómo Funciona Técnicamente

#### Flujo Completo de una Operación Live

```
                        ┌──────────────────────────────────────┐
                        │  MT5 Terminal (Broker conectado)      │
                        └───────┬──────────────────────────────┘
                                │ MetaTrader5 Python package
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  mt5_bridge.py                                                           │
│                                                                          │
│  ┌─────────────────┐   ┌──────────────────────┐   ┌──────────────────┐ │
│  │ tick_broadcaster │   │ strategy_scanner_task │   │ feedback_loop    │ │
│  │ (100ms / 10Hz)   │   │ (1Hz)                │   │ (cada 5s)        │ │
│  │                  │   │                      │   │                  │ │
│  │ • Lee bid/ask    │   │ FASE 1: Anclaje H4   │   │ • Consulta deals │ │
│  │ • Risk Guard     │   │ FASE 2: Rangos CRT   │   │   cerrados       │ │
│  │ • Emite "tick"   │   │ FASE 3: Sweep detect │   │ • Clasifica W/L  │ │
│  │                  │   │ FASE 4: Hard Rules   │   │ • Registra en    │ │
│  │                  │   │ FASE 5: ChromaDB     │   │   ChromaDB       │ │
│  │                  │   │ FASE 6: Ejecución    │   │ • Emite history  │ │
│  └──────┬──────────┘   └──────────┬───────────┘   └──────────────────┘ │
│         │                         │                                      │
│         │   ws://127.0.0.1:8000   │                                      │
└─────────┼─────────────────────────┼──────────────────────────────────────┘
          │                         │
          ▼                         ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                                       │
│                                                                          │
│  mock-feed.ts (normalizador)                                             │
│      ▼                                                                   │
│  trading-store.ts (Zustand + localStorage)                               │
│      ▼                                                                   │
│  ┌──────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │PriceChart│  │AccountStats│  │PositionsTable│  │HistoryPanel      │   │
│  │(velas +  │  │(balance,   │  │(posiciones   │  │(trades cerrados  │   │
│  │ CRT lines│  │ equity,    │  │ abiertas con │  │ con ChromaDB     │   │
│  │ en vivo) │  │ drawdown)  │  │ PnL flotante │  │ insights)        │   │
│  └──────────┘  └────────────┘  └──────┬──────┘  └──────────────────┘   │
│                                       │                                  │
│                            ModifySLTPModal (editar SL/TP en vivo)       │
│                            Cierre manual de posiciones                   │
└───────────────────────────────────────────────────────────────────────────┘
```

#### Motor de Ejecución (Las 6 Fases del Scanner)

El bot ejecuta las 6 fases secuenciales a 1Hz mediante `strategy_scanner_task`:

##### FASE 1 — Selección de la Vela de Anclaje H4

**Código:** `update_reference_ranges()` en `mt5_bridge.py`

El bot selecciona una vela H4 **cerrada y específica** según calendario basado en hora Canaria (`Atlantic/Canary`):

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

##### FASE 2 — Cálculo de Rangos CRT

Una vez seleccionada la vela de anclaje se extraen 3 niveles de precio:

```
CRT High = float(vela['high'])
CRT Low  = float(vela['low'])
EQ       = CRT_Low + 0.5 × (CRT_High − CRT_Low)   ← Equilibrium / Midpoint
```

Estos valores se almacenan en `anchor_ranges` y se envían al frontend como líneas horizontales sobre el gráfico (`anchor_update`). Solo se actualizan si los valores cambian.

---

##### FASE 3 — Detección del Barrido (Sweep)

**Código:** `strategy_scanner_task()` L636-641

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

##### FASE 4 — Filtros de Capa 1 (Hard Rules)

**Código:** `validate_hard_rules()` en `crt_logic.py`

5 filtros secuenciales. Si cualquiera falla → señal `DISMISSED`. El anti-spam evita repetir el mismo rechazo más de 1 vez por minuto.

**4.1 Filtro de Horario**

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

**4.2 Filtro de Spread**

```
spread_pips = current_spread_points / 10.0

Condición 1: spread_pips ≤ (0.20 × ltf_atr_M1)     ← ratio máximo del ATR
Condición 2: current_spread_points ≤ max_spread_points  ← límite absoluto en puntos
```

**Bypass:** ✅ `disable_spread_filter = True`

---

**4.3 Filtro de ATR Mínimo**

```
ltf_atr = ATR(M1, período 14)   ← True Range clásico convertido a pips

SI ltf_atr < min_atr_pips → RECHAZAR
```

**Bypass:** ✅ `disable_atr_filter = True`

---

**4.4 Filtro de Ratio Mecha CRT**

Evalúa la **última vela M1**, no la vela de anclaje H4:

```
candle_range = high − low
body_size    = |close − open|

SI body_size > candle_range × (max_wick_body_ratio / 100) → RECHAZAR
```

Un cuerpo M1 grande sugiere continuación (impulso), no reversión (trampa CRT).

**Bypass:** ✅ `disable_wick_body_filter = True`

---

**4.5 Filtro de Dimensión ⭐**

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

##### FASE 5 — Validación Semántica Capa 2/3 (ChromaDB)

**Código:** `validate_market_context()` en `context_engine.py`

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

##### FASE 6 — Ejecución y Gestión Post-Trade

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

### Qué se Aprecia en la Interfaz (Modo LIVE)

El modo LIVE comparte los mismos componentes visuales que DEMO, pero con **funcionalidad completa**:

| Elemento UI | Componente | Comportamiento en LIVE |
|-------------|-----------|----------------------|
| **Gráfico de velas** | `PriceChart.tsx` | Velas en tiempo real + líneas CRT dinámicas + **marcadores de entradas/salidas reales** |
| **Estadísticas de cuenta** | `AccountStats.tsx` | Balance y equity **reales del broker** actualizados a 10Hz. Drawdown bars con datos reales. Badge de estado de la cuenta |
| **Posiciones abiertas** | `PositionsTable.tsx` | **Posiciones reales** con PnL flotante actualizado en tiempo real. Acciones: cerrar posición, modificar SL/TP via `ModifySLTPModal` |
| **Historial de trades** | `HistoryPanel.tsx` | Trades reales cerrados con ChromaDB insights. Estadísticas acumuladas (W/L, Win Rate, Net pips) |
| **Configuración CRT** | `LeftSidebar.tsx` | Cambios se envían en tiempo real via WebSocket `BOT_CONFIG_UPDATE` al bridge |
| **Risk Guard visual** | `AccountStats.tsx` | Barras de drawdown cambian a rojo cuando `percent > 80%` |
| **Botón de pánico** | `LeftSidebar.tsx` | Detener bot inmediatamente |

### Estado Actual: ✅ Funcional

El modo LIVE es plenamente operativo. El bot ejecuta órdenes reales en MT5 cuando `BOT_ACTIVE = True`, gestiona posiciones, evalúa drawdown en tiempo real y alimenta el feedback loop de ChromaDB.

### Pendiente en LIVE
| Funcionalidad | Estado | Detalle |
|---------------|--------|---------|
| Trailing Stop dinámico | ❌ No implementado | `BotConfig.trailing_stop` se guarda pero no se usa. Debería mover SL a breakeven y luego seguir precio |
| Cierre parcial en Equilibrium | ❌ No implementado | `BotConfig.partial_close` se guarda pero no se usa. Debería cerrar X% del volumen cuando precio toque EQ |
| Confirmación TBS/TWS | ❌ No implementado | El sweep actual es de 1 tick. Falta confirmar cierre fuera/dentro del rango (TBS) y validar mecha ≥50% (TWS) |
| Confluencia M1/M15 | ❌ No implementado | `hybrid_m1_m15_confluence` se guarda pero no evalúa divergencias entre temporalidades |
| SMT Divergence Check | ❌ No implementado | `smt_divergence_check` se guarda pero no compara pares correlacionados (ej: EURUSD vs DXY) |
| Max posiciones real | ❌ No implementado | `max_positions = 3` existe pero el scanner solo comprueba `> 0` |
| Panel de evaluación en tiempo real | ❌ No implementado | Dashboard visual que muestre las 6 fases del scanner con semáforo live |
| Log de señales rechazadas | ❌ Parcial | Las señales `DISMISSED` se emiten como `signal_evaluation` pero no se persisten ni se visualizan en tabla dedicada |
| Alertas sonoras | ❌ No implementado | Sonido al abrir/cerrar operaciones o al activar Risk Guard |

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

## 🐢 Implementación CRT Real (TBS/TWS) — ✅ IMPLEMENTADO

> Lógica institucional de barrido implementada en `crt_logic.py` y orquestada por `strategy_scanner_task()` en `mt5_bridge.py`. Activable mediante flags de `BotConfig`.

### `classify_sweep_type()` — Clasificación TBS/TWS ✅

Función pura en `crt_logic.py` (L211). Evalúa la **vela_2** (la que barre) contra la **vela_3** (confirmación) respecto a CRT High/Low:

```
body_ratio = |close − open| / (high − low)   ← cuerpo de vela_2 sobre su rango
```

| Condición | Tipo | Confianza |
|-----------|------|-----------|
| Cuerpo cruza el nivel **Y** body_ratio < 20% | **TBS** | **1.00** |
| Cuerpo cruza el nivel **Y** body_ratio ≥ 20% | **TBS** | **0.65** |
| Solo la mecha cruza **Y** body_ratio < 20% | **TWS** | **0.75** |
| Solo la mecha cruza **Y** body_ratio ≥ 20% | **TWS** | **0.50** |
| La mecha no cruza **o** vela_3 no recupera dentro del rango | **INVALID** | 0.00 |

> La **regla del 20%** (`body_ratio < 0.20`) distingue un barrido limpio (mecha de rechazo) de un cierre impulsivo. TBS = cuerpo cierra fuera y vuelve dentro (A+); TWS = solo mecha penetra.

### Buffer `_sweep_pending` — Confirmación por Vela 3 ✅

`mt5_bridge.py` mantiene un dict `_sweep_pending` (L163). Cuando se detecta un sweep con `require_candle_confirmation` activo (L794):
1. Se almacena `{direction, vela_2, crt_high, crt_low, timestamp}` indexado por símbolo.
2. En el siguiente ciclo, se evalúa la **vela_3 candidata** con `classify_sweep_type()`.
3. **Timeout de 180s** (L739): si la vela 3 no confirma a tiempo, el pendiente se descarta.

### `calculate_dynamic_sl()` — SL detrás de la mecha ✅

`crt_logic.py` L246. SL colocado detrás del extremo de la mecha de vela_2 + **buffer de 1.5 pips**:
```
BUY:  SL = vela_2.low  − 1.5×pip_value
SELL: SL = vela_2.high + 1.5×pip_value
```
Usado en el scanner cuando `use_dynamic_sl` está activo (L916).

### `calculate_crt_targets()` — TP1/TP2 ✅

`crt_logic.py` L255. `TP1 = EQ` (equilibrium, 50% del rango), `TP2 = extremo opuesto` (100%). Usado cuando `use_crt_targets` está activo (L926).

### `check_smt_divergence()` — Divergencia SMT ✅

`crt_logic.py` L241. `True` si el par primario barrió un nivel y el correlacionado **no** (divergencia institucional EURUSD/GBPUSD). Aplicado en el scanner cuando `smt_divergence_enabled` está activo (L845-863); si no hay divergencia → señal `DISMISSED`.

### Cierre parcial en EQ + SL a breakeven ✅

`mt5_bridge.py` L1094-1118. Cuando `partial_close_at_eq` está activo y el precio alcanza EQ:
- Cierra `partial_close_pct`% del volumen (comment `CRT_EQ_PARTIAL`).
- Mueve el SL de la posición restante a **breakeven** (precio de entrada).

### Multiplicadores de lotaje TBS/TWS ✅

`mt5_bridge.py` L935-939. El lotaje base se multiplica según el tipo de sweep clasificado:
- **TBS → `model_tbs_risk_multiplier`** (default **1.0x** — máxima convicción).
- **TWS → `model_tws_risk_multiplier`** (default **0.5x** — convicción reducida).

### Flags de `BotConfig` que controlan cada feature

| Flag | Default | Controla |
|------|---------|----------|
| `require_candle_confirmation` | (ver dataclass) | Buffer `_sweep_pending` + clasificación TBS/TWS |
| `use_dynamic_sl` | — | SL detrás de mecha |
| `use_crt_targets` | — | TP1=EQ / TP2=extremo opuesto |
| `smt_divergence_enabled` | — | Filtro de divergencia SMT |
| `partial_close_at_eq` | `false` | Cierre parcial en EQ + breakeven |
| `partial_close_pct` | `50` | % de volumen a cerrar en parcial |
| `model_tbs_risk_multiplier` | `1.0` | Lotaje en sweeps TBS |
| `model_tws_risk_multiplier` | `0.5` | Lotaje en sweeps TWS |

> Todas las features dependen de `CRT_LOGIC_AVAILABLE` (import seguro de `crt_logic.py`). Si el módulo no carga, el scanner degrada al comportamiento básico de 1 tick sin romperse.

---

## 🛠️ Gaps Corregidos (Junio 2026)

| Corrección | Estado | Detalle |
|------------|--------|---------|
| Componente `ScannerLog` (panel de señales) | ✅ IMPLEMENTADO | `src/components/scanner/ScannerLog.tsx` lee `s.scannerSignals`, ahora presente en `trading-store.ts` (campo `scannerSignals` + acción `addScannerSignal`, cap 100). El handler `scanner_signal` en `mock-feed.ts` traduce los eventos del backend (`DETECTED`/`DISMISSED`/`EXECUTED`/`FAILED`) a la señal del store. |
| Handler `risk_guard_alert` en frontend | ❌ PENDIENTE | El backend emite `risk_guard_alert` (L1287) pero `mock-feed.ts` no lo procesa todavía. |
| Handler `anchor_update` en frontend | ❌ PENDIENTE | No hay branch `anchor_update` en `mock-feed.ts` (los handlers actuales son `bot_status`, `account`, `trade_result`, `positions`, `history`, `tick`, `history_full`, `history_init`, `history_update`). |
| Risk Guard conectado a `maxDailyLoss` de la UI | ✅ IMPLEMENTADO | `mt5_bridge.py` L1255-1271: usa `bot_config.max_daily_loss` si `> 0`, con **fallback** a `config_crt.json → max_daily_loss_pct`. Total = 2× diario por convención. |
| `maxPositions` validado contra posiciones totales | ✅ IMPLEMENTADO | L692-697: cuenta `mt5.positions_get()` (todas) y bloquea el scanner si `total_open >= max_positions` (antes solo comprobaba `> 0`). |
| Import de `crt_logic.py` con flag | ✅ IMPLEMENTADO | L31-35: `try/except` define `CRT_LOGIC_AVAILABLE`; toda la lógica CRT avanzada se condiciona a ese flag. |
| Filtro de posiciones manuales en el scanner | 🔶 PARCIAL | El scanner salta el símbolo si **cualquier** posición está abierta para ese par (L711-713), incluidas las manuales. La clasificación bot/manual sí distingue por comment `CRT` en `send_trade_history()` (L1391), pero el bloqueo del scanner **no** filtra manuales por comment. |
| Timezone unificado vía `_to_canary()` | ✅ IMPLEMENTADO | `mt5_bridge.py` L22: helper `_to_canary()` (pytz `Atlantic/Canary`) usado en validaciones horarias del scanner (L594, L633) y killzones. |

---

## 📊 Sistema de Historial Real y Métricas — ✅ IMPLEMENTADO

### `send_trade_history()` (backend) ✅

`mt5_bridge.py` L1367. Fuente: `mt5.history_deals_get()` (últimos 30 días). Por cada deal cerrado:
- Empareja el deal de cierre con su deal de apertura (`position_id`).
- **Clasifica origen** por comment: `bot` (empieza con `CRT` o contiene `scanner`), `bot_partial` (`CRT_EQ_PARTIAL`), o `manual`.
- Calcula **pips** (según `DEAL_TYPE` y pip_value del símbolo) y **duración** (cierre − apertura).
- Parsea `crt_meta` del comment enriquecido.
- Recupera SL/TP desde `mt5.history_orders_get()`.

Enviado como `history_full` al conectar un cliente y en **broadcast cada 30s** (feedback loop, 6 iteraciones × 5s).

### Métricas agregadas ✅

Calculadas en `send_trade_history()` y enviadas en el campo `metrics`: `total`, `wins`, `losses`, `win_rate`, `total_profit`, `total_pips`, `avg_win`, `avg_loss`, `profit_factor`, `avg_duration_s`, `max_dd_trade`, `bot_trades`, `manual_trades`, `tbs_count`, `tbs_wr`, `tws_count`, `tws_wr`.

### Comment enriquecido en órdenes ✅

`_build_crt_comment()` (`mt5_bridge.py` L653) genera el comment de las órdenes del bot, máx. 31 chars (límite MT5):
```
CRT|sweep:TBS|conf:1.00|kz:london
```
Incluye el tipo de sweep, la confianza y la killzone activa (`get_active_killzone_name()`). El parser en `send_trade_history()` lo reconstruye en `crt_meta`.

### Tabla del footer con filtros ✅

`src/components/history/HistoryTable.tsx`: lee `tradeHistory` y `tradeMetrics` del store. Tabs **Todos / Bot / Manual** (filtra por `origin`). Columnas: Ticket, Símbolo, Dir, Vol, P.Apertura, P.Cierre, Pips, P/L Neto, Duración, Origen (badge), Hora cierre. Tarjetas de métricas (Win Rate, Profit Factor, Total P/L, Pips, TBS WR, TWS WR) cuando hay métricas.

### Exportación para análisis ✅

Dos botones en `HistoryTable.tsx`:
- **"Copiar para IA"** → JSON compacto formato `crt-bot-export-v1` (claves cortas: `tk`, `sym`, `dir`, `pnl`, `pips`, `orig`, `crt`…) al portapapeles.
- **"Copiar resumen"** → texto plano con totales, WR, PF, P/L y desglose TBS/TWS.

---

## 🧬 Arquitectura Pluggable IStrategy — 🔶 PARCIAL (registrada, no conectada)

> Definida en `strategies/base_strategy.py` y `strategies/crt_strategy.py`. **El scanner aún NO la usa** — sigue ejecutando la lógica inline de `strategy_scanner_task()`. Es la base para una migración futura.

- **`IStrategy`** (ABC): método abstracto `evaluate(ctx) -> StrategySignal` y hook `on_trade_closed(profit, setup_context)`.
- **`MarketContext`** (dataclass): symbol, bid, ask, spread_points, atr_pips, crt_high/low, eq, anchor_time, velas M1.
- **`StrategySignal`** (dataclass): approved, direction, reason, sweep_type, confidence, sl_price, tp1/tp2_price, lot_multiplier.
- **`STRATEGY_REGISTRY`** + decorador **`@register_strategy`**: registro por `cls.name`.
- **`CRTStrategy`** (`name="crt"`): primera implementación — sweep H4 + `classify_sweep_type()` + SL dinámico + targets EQ. Registrada vía decorador.

**Estado:** ✅ registrada en el registry · ❌ NO invocada por el scanner (pendiente de migración).

---

## 🧭 Discriminación Direccional ChromaDB — ✅ IMPLEMENTADO

**Problema original:** las consultas semánticas no distinguían dirección, así que un **LOSS de BUY** podía bloquear una señal **SELL** similar (y viceversa), contaminando el aprendizaje.

**Solución** (`context_engine.py`):
- En las **queries** (L105-107): la dirección se inyecta como **token repetido de alto peso** — `"BUY BUY BUY | {setup_name}"` — para que el embedding pondere fuertemente la dirección.
- En **`add_trade_experience()`** (L168-174): al registrar el resultado de un trade, el setup se almacena con el mismo token direccional triplicado (`setup_initial_weighted`).

Esto separa el espacio semántico por dirección: los LOSS de BUY ya no atraen consultas SELL.

---

## 🧩 Estructura Técnica de la Metodología CRT (por Módulo)

### Distribución del Código CRT

La lógica CRT se distribuye en 3 módulos Python que separan responsabilidades:

```
┌─────────────────────────────────────────────────────────────┐
│  crt_logic.py  (Lógica pura, sin side effects)              │
│  ─────────────────────────────────────────────              │
│  • get_anchor_candle_params()  — Calendario de anclaje      │
│  • find_anchor_candle()        — Búsqueda H4 específica     │
│  • is_in_active_killzone()     — Validación de horario UTC  │
│  • check_sweep()               — Detección bid>high/ask<low │
│  • validate_hard_rules()       — 5 filtros secuenciales     │
└─────────────────────┬───────────────────────────────────────┘
                      │ importado por
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  mt5_bridge.py  (Orquestador con side effects)              │
│  ─────────────────────────────────────────────              │
│  • tick_broadcaster()          — Precio + Risk Guard (10Hz) │
│  • strategy_scanner_task()     — Ciclo de evaluación (1Hz)  │
│  • update_reference_ranges()   — Actualiza anclaje H4       │
│  • feedback_loop_task()        — Aprendizaje automático (5s)│
│  • try_order_send()            — Envío de órdenes IOC/FOK   │
│  • WebSocket server            — Comunicación con frontend  │
└─────────────────────┬───────────────────────────────────────┘
                      │ importa
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  context_engine.py  (Motor semántico)                        │
│  ─────────────────────────────────────────────               │
│  • init_chroma()               — Inicializa ChromaDB local  │
│  • load_curated_rules()        — Carga crt_rules_curated.md │
│  • validate_market_context()   — Query semántico Capa 2/3   │
│  • register_trade_feedback()   — Registra W/L en ChromaDB   │
│  │                                                           │
│  └── ChromaDB (chroma_db/)     — Colección crt_knowledge    │
│      └── SentenceTransformers  — all-MiniLM-L6-v2           │
└─────────────────────────────────────────────────────────────┘
```

### Reutilización entre Modos

| Función | DEMO | BACKTEST | LIVE |
|---------|------|----------|------|
| `get_anchor_candle_params()` | ✅ | ✅ (via `backtesting_engine.py`) | ✅ |
| `find_anchor_candle()` | ✅ | ✅ | ✅ |
| `check_sweep()` | ✅ (evalúa, no opera) | ✅ | ✅ |
| `validate_hard_rules()` | ✅ (evalúa, no opera) | ✅ | ✅ |
| `validate_market_context()` | ✅ (evalúa, no opera) | ✅ (con retry 3x) | ✅ |
| `try_order_send()` | ❌ (bloqueado) | ❌ (simulado en `SimEngine`) | ✅ |
| `feedback_loop_task()` | ❌ (sin trades) | ❌ (mock en `ResultsStreamer`) | ✅ |
| Risk Guard | ✅ (monitorea) | ❌ (no aplica) | ✅ (cierre de pánico) |

---

## 🏗️ Mapa de Componentes Frontend

### Componentes Compartidos (visibles en DEMO + LIVE)

| Componente | Archivo | Responsabilidad |
|-----------|---------|----------------|
| `Header` | `layout/Header.tsx` | Barra superior con logo, selectores, modos, indicador de conexión MT5 |
| `LeftSidebar` | `layout/LeftSidebar.tsx` | Modal flotante arrastrable con TODOS los parámetros del bot. Draft persistente en Zustand |
| `RightSidebar` | `layout/RightSidebar.tsx` | Watchlist de símbolos y resumen de mercado |
| `BottomPanel` | `layout/BottomPanel.tsx` | Pestañas: Posiciones activas + Historial |
| `PriceChart` | `chart/PriceChart.tsx` | Gráfico principal Lightweight Charts con líneas CRT, marcadores de trades |
| `SymbolSelector` | `chart/SymbolSelector.tsx` | Dropdown de cambio de símbolo |
| `TimeframeSelector` | `chart/TimeframeSelector.tsx` | Botones de temporalidad |
| `IndicatorMenu` | `chart/IndicatorMenu.tsx` | Menú de indicadores técnicos |
| `AccountStats` | `dashboard/AccountStats.tsx` | Balance, equity, drawdown con barras y badge |
| `PositionsTable` | `dashboard/PositionsTable.tsx` | Tabla de posiciones abiertas con PnL flotante |
| `HistoryPanel` | `dashboard/HistoryPanel.tsx` | Historial con ChromaDB insights expandibles |
| `TradeNotifications` | `dashboard/TradeNotifications.tsx` | Toasts de notificación |

### Componentes Exclusivos de BACKTEST

| Componente | Archivo | Responsabilidad |
|-----------|---------|----------------|
| `BacktestPanel` | `backtest/BacktestPanel.tsx` | Sidebar de configuración: símbolo, temporalidad, fechas, parámetros, botones de control |
| `BacktestChart` | `backtest/BacktestChart.tsx` | Gráfico de velas simuladas con marcadores de trades del backtest |
| `MetricsPanel` | `backtest/MetricsPanel.tsx` | 5 tarjetas KPI con coloreado semántico |
| `EquityCurveChart` | `backtest/EquityCurveChart.tsx` | Curva de equity SVG con gradiente y labels dinámicos |
| `TradeLog` | `backtest/TradeLog.tsx` | Tabla de todas las operaciones del backtest con detalle ChromaDB |
| `BacktestExport` | `backtest/BacktestExport.tsx` | Exportación de resultados |

### Stores (Estado Global)

| Store | Archivo | Ámbito |
|-------|---------|--------|
| `useTradingStore` | `store/trading-store.ts` | Estado de mercado real: ticks, posiciones, historial, cuenta, config del bot |
| `useBacktestStore` | `store/backtest-store.ts` | Estado aislado de backtesting: velas simuladas, trades, equity, métricas |
| `useModeStore` | `store/mode-store.ts` | Modo activo: DEMO / BACKTEST / LIVE |
| `useChartStore` | `store/chart-store.ts` | Símbolo y temporalidad seleccionados |
| `useStrategyStore` | `store/strategy-store.ts` | Estado de la estrategia activa |

---

## 🚧 Parámetros: Activos vs Fantasma

### ✅ Ya implementados (antes fantasma)

| Funcionalidad | Dónde se define | Estado |
|---------------|----------------|--------|
| **TBS / TWS** — clasificación de barrido | `crt_logic.classify_sweep_type()` | ✅ Implementado |
| **Cierre parcial en EQ** | `BotConfig.partial_close_at_eq` / `partial_close_pct` | ✅ Implementado (L1094) |
| **SMT Divergence Check** | `BotConfig.smt_divergence_enabled` | ✅ Implementado (L845) |
| **Multiplicadores TBS/TWS** | `BotConfig.model_tbs/tws_risk_multiplier` | ✅ Implementado (L935) |
| **Max posiciones (límite real)** | `BotConfig.max_positions` | ✅ Implementado (L692, cuenta totales) |
| **Max daily loss desde UI** | `BotConfig.max_daily_loss` | ✅ Implementado (L1255, fallback a JSON) |
| **SL dinámico + targets CRT** | `BotConfig.use_dynamic_sl` / `use_crt_targets` | ✅ Implementado (L916/L926) |

### ❌ Aún fantasma (sin lógica activa)

| Funcionalidad | Dónde se define | Estado |
|---------------|----------------|--------|
| **Selector de estrategia** | `STRATEGY_REGISTRY` / `useStrategyStore` | ❌ Registry existe, scanner no lo usa |
| **Trailing Stop** | `BotConfig.trailing_stop` | ❌ Se guarda, no se usa |
| **Confluencia M1/M15** | `BotConfig.hybrid_m1_m15_confluence` | ❌ Se guarda, no se evalúa |
| **ATR body ratio** | `config_crt.json → min_body_to_atr_ratio` | ❌ Definido en JSON, no evaluado |

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

### 5. Aislamiento Total de Estado por Modo
`backtest-store.ts` es completamente independiente de `trading-store.ts`. Los mensajes WebSocket con prefijo `backtest_` se enrutan a handlers separados en `backtest-feed.ts`, evitando contaminación cruzada. Esto permite ejecutar un backtest mientras el feed live sigue activo en segundo plano.

### 6. Separación de Lógica Pura vs Orquestación
`crt_logic.py` contiene funciones puras sin side effects (no toca MT5 ni ChromaDB directamente), lo que permite reutilizarlas tanto en el scanner live (`mt5_bridge.py`) como en el motor de backtesting (`backtesting_engine.py`) sin duplicación de código.

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
   - **Causa:** El estado local de React se iniciaba sincrónicamente desde los valores por defecto del store antes de que Zustand completase la hidratación desde `localStorage`, y no existía un borrador persistente para los cambios no aplicados.
   - **Fix:** Se introdujo `draftBotConfig` en Zustand junto a un listener asíncrono de hidratación en `LeftSidebar.tsx`. El componente ahora sincroniza su estado local hacia `draftBotConfig` de forma persistente en cada pulsación, previniendo la pérdida de datos sin sobrecargar el WebSocket.

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

6. **Errores de Tipado TypeScript en Next.js Build:**
   - **Síntoma:** Falla en la compilación de producción (`npm run build`) debido a que la propiedad `setMarkers` de Lightweight Charts y el atributo `title` en iconos de Lucide-React generaban error de tipo estricto.
   - **Fix:** Se aplicó un cast de seguridad (`as any`) para `setMarkers` en `BacktestChart.tsx` y se reestructuró el JSX en `TradeLog.tsx` envolviendo los iconos SVG en elementos `<span>` para proporcionar el tooltip nativo sin quebrar los tipos de la librería de iconos.

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

### Prioridad Alta
1. **Handlers `risk_guard_alert` y `anchor_update` en frontend:** El backend ya los emite; `mock-feed.ts` aún no los procesa (el handler `scanner_signal` ya quedó cableado).
3. **Migrar el scanner a `IStrategy`:** Conectar `strategy_scanner_task()` a `STRATEGY_REGISTRY` / `CRTStrategy` en vez de la lógica inline. Habilitar el selector de estrategia.
4. **Filtro de manuales en el bloqueo del scanner:** Hoy cualquier posición abierta (incluida manual) salta el símbolo; filtrar por comment `CRT` para que las manuales no detengan al bot.

### Prioridad Media
5. **Trailing Stop:** `BotConfig.trailing_stop` se guarda pero no mueve el SL. Implementar breakeven + seguimiento.
6. **Confluencia M1/M15:** `hybrid_m1_m15_confluence` sin lógica de divergencia entre temporalidades.
7. **UI del Optimizador:** Panel frontend para `optimizer.py` (grilla, heatmap, mejores combinaciones).
8. **Panel de evaluación CRT en tiempo real:** Semáforo por fase del scanner.

### Prioridad Baja
8. **Walk-forward analysis:** Validación de robustez con ventanas in-sample/out-sample.
9. **Multi-símbolo en backtest:** Ejecución paralela sobre varios pares.
10. **Alertas sonoras:** Notificaciones de audio para trades y Risk Guard.
11. **Slippage y comisiones:** Simulación realista de costos de trading en el backtester.
