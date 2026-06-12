# Documentación Técnica — Dashboard de Trading Híbrido CRT

> **Última actualización:** 2026-06-11 (tarde) · **Versión del documento:** v3.2
>
> Leyenda de estado: ✅ IMPLEMENTADO · 🔶 PARCIAL · ❌ PENDIENTE
>
> *Todas las marcas ✅/🔶/❌ de este documento se verificaron leyendo el código fuente real (junio 2026).*

### Stack Tecnológico

| Capa | Tecnologías |
|------|-------------|
| **Frontend** | Next.js 16, TypeScript, Zustand, Lightweight Charts, Tailwind CSS |
| **Backend/Bridge** | Python 3.x, paquete `MetaTrader5`, `websockets`, `asyncio`, `pytz` |
| **IA/Contexto** | ChromaDB, SentenceTransformers (`all-MiniLM-L6-v2`) |
| **Herramientas** | Antigravity (agente IA), Claude (análisis y prompts) |

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

`mt5_bridge.py` L1094-1120, dentro del `positions_broadcaster`. Usa dos estructuras de control: `_crt_eq_target` (dict symbol→precio EQ, L166) y `_eq_done` (set de tickets ya parcialmente cerrados, L167). Cuando `partial_close_at_eq` está activo y el precio alcanza EQ:
- Cierra `partial_close_pct`% del volumen (comment `CRT_EQ_PARTIAL`).
- Mueve el SL de la posición restante a **breakeven** (`pos.price_open`) vía `TRADE_ACTION_SLTP`.
- Marca el ticket en `_eq_done` para no repetir; `_eq_done` se purga de tickets ya cerrados en cada ciclo.

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
| `maxPositions` validado contra posiciones totales | 🔶 PARCIAL | L692-697: cuenta `mt5.positions_get()` (**todas**, sin filtrar por comment) y bloquea el scanner si `total_open >= max_positions` (antes solo comprobaba `> 0`). Las posiciones manuales **sí cuentan** para el límite. |
| Import de `crt_logic.py` con flag | ✅ IMPLEMENTADO | L31-35: `try/except` define `CRT_LOGIC_AVAILABLE`; toda la lógica CRT avanzada se condiciona a ese flag. |
| Filtro de posiciones manuales en el scanner | 🔶 PARCIAL | El scanner salta el símbolo si **cualquier** posición está abierta para ese par (L711-713), incluidas las manuales. La clasificación bot/manual sí distingue por comment `CRT` en `send_trade_history()` (L1391), pero el bloqueo del scanner **no** filtra manuales por comment — sigue pendiente. |
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

## 🧪 Optimización ChromaDB (11 junio 2026) — ✅ IMPLEMENTADO

> Verificado leyendo `context_engine.py` y la integración en `mt5_bridge.py` (scanner). Esta revisión cambia el **paradigma** de ChromaDB: deja de ser un guardián que bloquea señales para convertirse en un clasificador de contexto **informativo**.

### CHROMA-OPT-1 — Colecciones dedicadas por símbolo (distancia coseno) ✅

`get_collection_for_symbol(symbol)` (`context_engine.py` L27-39) crea/cachea una colección `crt_knowledge_{symbol}` (ej. `crt_knowledge_EURUSD`, `crt_knowledge_GBPUSD`) con `metadata={"hnsw:space": "cosine"}`. La colección global `crt_knowledge` se conserva como backup de reglas curadas y **no se elimina**.

`migrate_to_symbol_collections()` (L42-88) migra al arranque las experiencias de trade (`source: execution_history`) de la colección global a las colecciones por símbolo. Es **idempotente** (no reinserta ids ya existentes en destino), descarta registros sin metadata `symbol`, y emite un log con el resumen de registros movidos (`[CHROMA] Migración: N a EURUSD, M a GBPUSD`). Importada y ejecutada desde `mt5_bridge.py` (L14).

### CHROMA-OPT-2 — Embeddings estructurados clave-valor ✅

Antes: texto descriptivo largo (`"Setup: Sweep High Reversal (SELL). Market Context: Symbol: EURUSD, Price: ..."`).
Ahora: formato compacto clave-valor, **idéntico** en query y en registro, para máxima consistencia semántica:

```
# Query (validate_market_context, L177-180):
SYM:EURUSD|DIR:SELL|SWEEP:TBS|KZ:london

# Documento almacenado (add_trade_experience, L228-232):
SYM:EURUSD|DIR:SELL|RESULT:LOSS|SWEEP:TBS|KZ:london|PIPS:-15.0|SPREAD:1.2
```

Además, las queries aplican un **filtro estricto en metadata** (`where={"$and": [{"symbol": symbol}, {"trade_type": direction}]}`, L188) que aísla por símbolo **y** dirección a nivel de base de datos — no solo por ponderación semántica.

### CHROMA-OPT-3 — Clasificación informativa (NEW / WIN_MATCH / LOSS_MATCH), sin bloqueo ✅

`validate_market_context()` (L163-210) **ya no detiene señales**. Retorna `{"context": "NEW"|"WIN_MATCH"|"LOSS_MATCH", "approved": True, "distance": float, "reason": str}`. El campo `approved` es **siempre `True`** (se conserva por compatibilidad con los llamadores).

- **NEW** — sin experiencias previas similares (o sin match cercano).
- **WIN_MATCH** — experiencia previa ganadora similar (`distance < chroma_threshold` y `outcome == WIN`).
- **LOSS_MATCH** — experiencia previa perdedora similar (`outcome == LOSS`).

En el scanner (`mt5_bridge.py` L963-984): el resultado se computa de forma **no bloqueante** (try/except que degrada a `NEW` ante cualquier error), se loguea (`[CHROMA] Contexto: ...`) y se incluye como campo `chroma_context` en el evento `scanner_signal` (acción `DETECTED`) para visibilidad en la UI. El comentario del código lo deja explícito: *"ChromaDB es solo INFORMATIVO — nunca bloquea ni toca el lote"* (L963). El disparo autónomo de la orden ocurre **después**, sin condicionarse al contexto (L986: *"SEÑAL CONFIRMADA: DISPARO AUTÓNOMO (ChromaDB no la detiene)"*).

### Gestión de riesgo — el lotaje es SIEMPRE el de la UI ✅

`volume = lot` (`mt5_bridge.py` L1014, comentado *"Lotaje controlado desde el frontend"*). ChromaDB **no modifica el lote** bajo ninguna circunstancia. Decisión de diseño explícita del usuario.

> Nota: el único ajuste de lotaje que sí existe es el multiplicador **TBS/TWS** (L1017-1019), que es una feature CRT independiente de ChromaDB y solo actúa con `require_candle_confirmation` activo.

### CHROMA-OPT-4 — Operaciones no bloqueantes (`asyncio.to_thread`) ✅

Wrappers async (`context_engine.py` L270-274): `validate_market_context_async()` y `add_trade_experience_async()` ejecutan las operaciones ChromaDB (CPU-bound: embedding + búsqueda HNSW) en un **hilo secundario** vía `asyncio.to_thread`, evitando bloquear el event loop del bridge. El scanner usa exclusivamente las versiones async (L967, L1850).

### Problema que resolvió

1. **Contaminación cruzada por símbolo:** un LOSS de EURUSD podía recuperarse al evaluar GBPUSD si el contexto semántico era similar. Resuelto con colecciones por símbolo + filtro `where` estricto.
2. **Sobre-bloqueo semántico masivo:** el paradigma anterior bloqueaba señales por similitud de distancia con cualquier LOSS, deteniendo operaciones válidas. Resuelto eliminando el bloqueo: ChromaDB ahora solo clasifica el contexto, nunca detiene la señal ni altera el riesgo.

---

## 🎨 Decoraciones Visuales del Gráfico (11 junio 2026) — ✅ IMPLEMENTADO

> Verificado en `src/components/chart/PriceChart.tsx`. Todas las decoraciones se dibujan con `series.createPriceLine()` (líneas horizontales nativas), persistentes al cambiar de temporalidad.

### Capa 1 — Rango Diario D1 de referencia (líneas punteadas verde/rojo) ✅

`PriceChart.tsx` L896-933. Lee `dailyRanges[symbol]` del store (`dailyRange`). Dibuja dos `priceLine`:
- **D1 High** — verde punteada (`title: "D1 High"`).
- **D1 Low** — rojo punteada (`title: "D1 Low"`).

Se recrean al cambiar `dailyRange` o `symbol`.

### Capa 2 — Rango H4 de anclaje (CRT High/Low + EQ amarilla) ✅

`PriceChart.tsx` L935-984. A partir del `anchorRange` del símbolo dibuja:
- **CRT High / CRT Low** — líneas azules.
- **EQ 50%** — línea amarilla punteada (`title: "EQ 50%"`, equilibrium del rango H4).

### Capa 3 — Indicador de sweep esperado (naranja) ✅

`PriceChart.tsx` L990-1025. `sweepLineRef` mantiene una única `priceLine` naranja en el extremo del rango H4 hacia donde se espera el barrido (`anchorRange.low` si dirección BUY, `anchorRange.high` si SELL). Se actualiza con throttle de 5s y se limpia si no hay dirección activa.

### Capa 4 — Zonas FVG (Fair Value Gap) con pares de priceLines ✅

`detectFVGs()` (L104-151) detecta huecos de 3 velas (alcista: hueco entre high de c1 y low de c3; bajista: inverso) y **filtra solo los FVGs no rellenados** por precio posterior. `updateFVGs()` (L1128-1167):
- Solo se muestran en temporalidades bajas (`1m`, `3m`, `5m`, `15m`, `30m`).
- Máximo **5** FVGs más recientes (`.slice(-5)`).
- Cada FVG = par de `priceLines` (top + bottom): **verde** (`rgba(34,197,94,0.4)`) si alcista, **rojo** (`rgba(239,68,68,0.4)`) si bajista. Títulos `FVG ▲` / `FVG ▼`.

### Bug resuelto: `series.setMarkers` no existe en esta versión de Lightweight Charts ✅

El primer intento de FVG usaba `series.setMarkers()`, método **inexistente** en la API de esta versión (error en runtime). Se reemplazó por `series.createPriceLine()` (comentado `[CHART-VISUAL-FIX]`, L183, L1128), compatible con todas las versiones y coherente con el resto de decoraciones.

### Lógica de la vela D1 de referencia (backend `emit_daily_range`) ✅

`mt5_bridge.py` L596-676. Selecciona la **última vela D1 CERRADA** que cumple **dos** condiciones simultáneas:
1. **Contención:** el precio actual (`current_bid`) está dentro del rango de mecha (`wick_low ≤ bid ≤ wick_high`).
2. **No rota por cuerpo:** ninguna vela cerrada posterior superó su high/low con el **cuerpo** (`max/min(open, close)`), no con la mecha.

La vela **en formación nunca participa** (ni como candidata ni como evaluadora — `copy_rates_from_pos(..., start_pos=1)`). Logs `[D1-RANGE]` detallan cada evaluación (⏭️ fuera de rango / ❌ rota por cuerpo / ✅ válida / fallback). Emitido como mensaje `daily_range` (broadcast o al cliente que conecta).

> **ACLARACIÓN OPERATIVA:** el rango D1 es **SOLO VISUAL** (referencia para el operador). El bot **opera únicamente con el rango H4 de anclaje por calendario** (Fase 1 del scanner). El rango D1 no entra en ninguna decisión de ejecución.

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

## 🚧 Mapa de Parámetros (por efecto real verificado)

### ✅ ACTIVOS — efecto real siempre que el bot opera

| Funcionalidad | Dónde se define | Verificación |
|---------------|----------------|--------------|
| **Max daily loss desde UI** | `BotConfig.max_daily_loss` | L1255, fallback a `config_crt.json` |
| **Max posiciones (límite)** | `BotConfig.max_positions` | L692 (cuenta totales, incl. manuales 🔶) |
| **Lotaje / TP / SL base** | `BotConfig.lotSize/takeProfitPips/stopLossPips` | Request de orden |
| **Killzones + horarios** | `BotConfig.killzones` + `*_start/*_end` | `is_in_active_killzone()` (L591) |
| **Bypass Capa 1** | `disable*Filter` + umbrales | `validate_hard_rules()` |

### 🔶 CONDICIONALES — requieren flag activo (y `CRT_LOGIC_AVAILABLE`)

| Funcionalidad | Flag | Verificación |
|---------------|------|--------------|
| **TBS / TWS** — clasificación de barrido | `require_candle_confirmation` | `classify_sweep_type()` (L211) |
| **SL dinámico (mecha + 1.5 pips)** | `use_dynamic_sl` | L916 |
| **Targets CRT (EQ / extremo)** | `use_crt_targets` | L926 |
| **Cierre parcial en EQ + breakeven** | `partial_close_at_eq` / `partial_close_pct` | L1094 |
| **SMT Divergence** | `smt_divergence_enabled` | L845 |
| **Multiplicadores TBS/TWS** | `model_tbs/tws_risk_multiplier` | L935 |

### ❌ DECORATIVOS — sin lógica activa (se guardan, no se usan)

| Funcionalidad | Dónde se define | Estado |
|---------------|----------------|--------|
| **Selector de estrategia** | `STRATEGY_REGISTRY` / `useStrategyStore` | Registry existe, scanner no lo usa |
| **Trailing Stop** | `BotConfig.trailing_stop` / `trailingStop` | Se guarda, no se usa |
| **Confluencia M1/M15** | `BotConfig.hybrid_m1_m15_confluence` | Se guarda, no se evalúa |
| **ATR body ratio** | `config_crt.json → min_body_to_atr_ratio` | Definido en JSON, no evaluado |

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

## ⚠️ Problemas Conocidos Activos

| Problema | Estado | Detalle (verificado en código) |
|----------|--------|-------------------------------|
| **ChromaDB — contaminación cruzada por símbolo** | ✅ RESUELTO (11 jun tarde) | Resuelto en la optimización ChromaDB: colecciones dedicadas por símbolo (`crt_knowledge_{symbol}`) + filtro estricto `where={"$and": [{"symbol": symbol}, {"trade_type": direction}]}` en las queries (`context_engine.py` L188). Ya no hay recuperación cruzada entre pares. Ver sección "Optimización ChromaDB". |
| **Docstring obsoleto en `is_in_active_killzone()`** | 🔶 Cosmético | El docstring dice "hora UTC actual" (L592) pero el código ya usa `_to_canary()` (L594). El comportamiento es correcto (Canary); solo el comentario quedó desactualizado. |
| **`maxPositions` / bloqueo del scanner cuentan posiciones manuales** | 🔶 Pendiente | Ver tabla de Gaps: el límite y el salto de símbolo no filtran por comment `CRT`, así que operaciones manuales afectan al bot. |
| **Handlers `risk_guard_alert` / `anchor_update` sin frontend** | ❌ Pendiente | El backend los emite; `mock-feed.ts` no los procesa. No hay campo `anchorRanges` en el store. |
| **IStrategy registrada pero no conectada** | 🔶 Pendiente | Ver sección IStrategy: el scanner sigue con lógica inline. |

---

## ❌ Intento Fallido: Rangos Estructurales con Bias (11 junio 2026) — ❌ PENDIENTE

> Lección aprendida documentada para un reintento futuro. **Ninguno de estos cambios está en el código** — el usuario los rechazó en su totalidad. Verificado: `crt_logic.py` **no contiene** `is_range_broken`, `find_structural_range`, `compute_range_bias` ni `effective_bias`; `mt5_bridge.py` **no contiene** `_structural_ranges` ni `update_structural_ranges`. El scanner sigue anclando por **calendario H4** sin cambios.

### Objetivo (no alcanzado)

Reemplazar el anclaje H4 por calendario con una **selección estructural** del rango (última vela no rota por cuerpo, con tolerancia de mecha y retorno al rango) y añadir un **sistema de bias direccional D1/H4** como **filtro operativo del scanner** (no solo visual).

### Resultado

La implementación del agente **no cumplió la especificación** del usuario. El usuario **RECHAZÓ todos los cambios** (rechazo limpio, sin restos en el código). Lección: el prompt monolítico falló — se reintentará con **micro-prompts más pequeños y aislados**.

### Especificación a preservar (para reintento futuro)

Copiada tal cual de la solicitud original del usuario:

- **Rango válido** = última vela cerrada cuyo max/min de **mecha** no fue superado **con cuerpo** por velas posteriores cerradas.
- **Tolerancia:** exceso de cuerpo ≤ **2.5 pips (EURUSD)** / ≤ **3 pips (GBPUSD)** con retorno al rango → el rango sigue válido hasta llegar al extremo opuesto.
- **Bias D1:** max tomado → el bias se mantiene hasta tomar el min (y viceversa).
- **Bias H4 con confluencia D1:** se mantiene hasta completar la expansión al extremo opuesto del rango D1.
- Las reglas deben ser **operativas** (filtro del scanner), **no solo visuales**.

---

## 📜 Historial de Tareas Realizadas (Junio 2026)

| # | Tarea | Resultado |
|---|-------|-----------|
| 0 | **Auditoría técnica inicial** (informe `analisis-bot`) | Detección de gaps entre reglas CRT documentadas y código real |
| 1 | **Corrección de 6 gaps críticos** | Handler base de señales, Risk Guard ↔ `maxDailyLoss`, `maxPositions` total, import `crt_logic` con flag, aislamiento de `runner.ts`, base de `risk_guard_alert` |
| 2 | **Implementación CRT real (7 pasos)** | `classify_sweep_type` (TBS/TWS + regla 20%), `_sweep_pending` (confirmación vela 3 + timeout 180s), SL dinámico, targets EQ, SMT divergence, multiplicadores TBS/TWS, timezone unificado |
| 3 | **Micro-prompts A–E: sistema de historial** | `send_trade_history()`, comment enriquecido, tabla footer con filtros, métricas agregadas, exportación "Copiar para IA" / "Copiar resumen" |
| 4 | **Fix: bucle infinito `BOT_CONFIG_UPDATE`** | `git checkout` de 5 archivos para revertir el estado que reenviaba config en bucle |
| 5 | **Fix: scanner bloqueado por posiciones manuales** | Identificado (🔶 parcial — bloqueo por símbolo aún cuenta manuales) |
| 6 | **Fix: escala de precios 5 decimales** | `priceFormat` (precision 5, minMove 0.00001) en velas + EMAs, `localization.priceFormatter`, `scaleMargins` en `PriceChart.tsx` |
| 7 | **Fix: sticky header + scroll en tabla historial** | `min-h-0` en cadena flex de `BottomPanel`, `overflow-x/y-auto` + `min-w-max` en tablas, `thead` sticky |
| 8 | **Cableado de `ScannerLog`** | `scannerSignals` + `addScannerSignal` en store, handler `scanner_signal` en `mock-feed.ts` |
| 9 | **Scripts de verificación** | `verify_crt_behavior.py` y `diagnostic_crt.py` (cliente WS de diagnóstico del scanner) |
| 10 | **Documentación v2.0 → v3.0** | Verificación contra código real, reclasificación de parámetros, secciones de problemas conocidos e historial |
| 11 | **Fix: sticky header opaco en HistoryTable** | Rediseño de `thead` para aplicar `sticky`/`bg-zinc-950`/`border-b` por celda individual (`<th>`), eliminando transparencia de filas al hacer scroll (ver detalle abajo) |
| 12 | **Script de auditoría `audit_crt.py`** | Cliente WebSocket que intercepta `BOT_CONFIG_UPDATE` y muestra qué features CRT están realmente activas vs decorativas, con resumen semáforo |
| 13 | **Optimización ChromaDB completa (11 jun tarde, 4 cambios)** | (1) Colecciones por símbolo con distancia coseno + migración automática; (2) embeddings estructurados clave-valor (`SYM\|DIR\|RESULT\|SWEEP\|KZ`); (3) clasificación informativa NEW/WIN_MATCH/LOSS_MATCH (deja de bloquear señales; lotaje siempre de la UI); (4) operaciones no bloqueantes con `asyncio.to_thread` |
| 14 | **Decoraciones visuales del gráfico (11 jun tarde)** | Rango D1 (verde/rojo punteado), rango H4 de anclaje (azul + EQ amarilla), indicador de sweep esperado (naranja), zonas FVG en M1/M5/M15 (pares de priceLines, solo no rellenados, máx 5) |
| 15 | **Iteraciones de la lógica de vela D1 de referencia (4 versiones)** | Iterado hasta la regla final: última vela CERRADA con contención de precio + no superada por el CUERPO de velas posteriores; la vela en formación nunca participa. Logs `[D1-RANGE]` |
| 16 | **Fix error `setMarkers` en `PriceChart.tsx`** | `series.setMarkers` no existe en esta versión de Lightweight Charts → reemplazado por `series.createPriceLine` para los FVG (`[CHART-VISUAL-FIX]`) |
| 17 | **Intento RECHAZADO de rangos estructurales + bias** | Reimplementación estructural del anclaje + bias D1/H4 como filtro operativo. No cumplió la especificación → usuario rechazó todos los cambios (rechazo limpio). Spec preservada para reintento con micro-prompts |

---

## 🗓️ Sesión del 2026-06-11 — Implementaciones Detalladas

Esta sección documenta con precisión técnica todo lo ejecutado durante la sesión del 11 de junio de 2026, agrupado por commit y módulo afectado.

---

### Commit `ea7a1ac` — feat: CRT methodology v2 - TBS/TWS, real history, IStrategy architecture

**Alcance:** 18 archivos, +1815 / -622 líneas. La iteración de mayor peso técnico del proyecto hasta la fecha.

---

#### 1. Unificación de Timezone (`mt5_bridge.py` L14-26)

**Problema previo:** `is_in_active_killzone()` comparaba `hora UTC` × `hora Canaria` en distintos puntos del código, pudiendo divergir en ±1h dependiendo del DST activo en `Atlantic/Canary`.

**Solución implementada:**

```python
import pytz as _pytz
_TZ_UTC    = _pytz.timezone("UTC")
_TZ_CANARY = _pytz.timezone("Atlantic/Canary")

def _to_canary(utc_naive_dt):
    return utc_naive_dt.replace(tzinfo=_TZ_UTC).astimezone(_TZ_CANARY)
```

El helper `_to_canary()` recibe un `datetime` naive (como los que retorna `datetime.datetime.utcnow()`) y devuelve un `datetime` aware en hora Canaria, respetando automáticamente DST. Todas las validaciones horarias del scanner (L591, L633, killzones, Nine AM model) ahora usan exclusivamente esta función. Se eliminó la duplicidad de rutas timezone que existía entre el pre-filtro (`is_in_active_killzone`) y la validación de Capa 1 (`validate_hard_rules`).

---

#### 2. Import seguro de `crt_logic.py` con flag `CRT_LOGIC_AVAILABLE` (`mt5_bridge.py` L28-37)

```python
try:
    from crt_logic import classify_sweep_type, check_smt_divergence
    CRT_LOGIC_AVAILABLE = True
except ImportError as e:
    CRT_LOGIC_AVAILABLE = False
    _crt_logic_import_error = str(e)
```

El log del resultado se emite diferido (L104-107), después de que el `logger` ya está configurado. Todo bloque de lógica CRT avanzada se protege con `if CRT_LOGIC_AVAILABLE`, garantizando degradación elegante al comportamiento básico de 1-tick si el módulo no carga (por ejemplo, en entornos sin `crt_logic.py` instalado).

---

#### 3. Nuevos flags en `BotConfig` dataclass (`mt5_bridge.py` L62-68)

Se añadieron 5 campos con `default=False` (conservador):

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `require_candle_confirmation` | `bool` | Activa buffer `_sweep_pending` + clasificación TBS/TWS |
| `use_dynamic_sl` | `bool` | SL calculado sobre mecha de vela_2 (+ 1.5 pips buffer) |
| `use_crt_targets` | `bool` | TP1 = EQ (50%), TP2 = extremo opuesto del rango H4 |
| `partial_close_at_eq` | `bool` | Cierra `partial_close_pct`% del volumen cuando precio toca EQ |
| `smt_divergence_enabled` | `bool` | Filtra la señal si ambos pares correlacionados barren simultáneamente |

El default `False` asegura que el bot al arrancar siga funcionando exactamente igual que antes de esta sesión. El usuario activa cada feature desde la UI.

---

#### 4. Implementación `classify_sweep_type()` en `crt_logic.py` (L211-245)

Función pura (sin side effects). Evalúa **vela_2** (la que barre el nivel) y **vela_3** (la vela de confirmación) para clasificar el tipo de barrido:

```python
body_ratio = abs(vela_2["close"] - vela_2["open"]) / (vela_2["high"] - vela_2["low"])
```

| Condición sobre vela_2 | Tipo | Confianza |
|------------------------|------|-----------|
| Cuerpo cruza nivel + body_ratio < 20% | TBS | 1.00 — mecha limpia de rechazo |
| Cuerpo cruza nivel + body_ratio ≥ 20% | TBS | 0.65 — cierre fuera pero cuerpo grande |
| Solo mecha cruza + body_ratio < 20% | TWS | 0.75 — mecha penetra, cuerpo adentro |
| Solo mecha cruza + body_ratio ≥ 20% | TWS | 0.50 — mecha y cuerpo ambiguos |
| Mecha no cruza o vela_3 no recupera | INVALID | 0.00 — descartado |

**La regla del 20%** es el discriminador clave entre una trampa institucional (mecha limpia, cuerpo pequeño) y un impulso direccional (cuerpo grande, sin trampa).

---

#### 5. Buffer `_sweep_pending` — Confirmación por Vela 3 (`mt5_bridge.py` L163-165, L732-804)

```python
_sweep_pending: dict = {}   # { symbol: {direction, vela_2, crt_high, crt_low, timestamp} }
```

**Flujo cuando `require_candle_confirmation=True`:**

```
Ciclo 1 (tick supera CRT level):
  → Se detecta el sweep
  → Se descarga la vela M1 actual como vela_2
  → Se almacena en _sweep_pending[symbol] con timestamp
  → El ciclo CONTINÚA sin evaluar Capa 1/2 aún

Ciclos 2..N (hasta 180s después):
  → Se comprueba si existe _sweep_pending[symbol]
  → Se descarga la vela M1 más reciente como vela_3_candidate
  → Se verifica que vela_3.time > vela_2.time (es una nueva vela)
  → Se llama classify_sweep_type(vela_2, vela_3, crt_h, crt_l, direction)
  → Si INVALID → del _sweep_pending[symbol] → descartado
  → Si TBS/TWS → continúa hacia Capa 1/2/3 con sweep_type y sweep_confidence
```

**Timeout de 180 segundos:** si la vela 3 no aparece o no confirma en 3 minutos, el pendiente se descarta automáticamente. Esto evita sweeps "zombie" que contaminen el siguiente ciclo de mercado.

---

#### 6. `calculate_dynamic_sl()` (`crt_logic.py` L246-254)

SL posicionado detrás del extremo de la mecha de la vela que efectuó el barrido:

```python
# BUY (sweep del low):
sl_price = vela_2["low"] - buffer_pips * pip_value

# SELL (sweep del high):
sl_price = vela_2["high"] + buffer_pips * pip_value
```

El `buffer_pips=1.5` añade margen para spread y microslippage sin alejarse del nivel invalidado por la mecha. Solo se aplica si el SL calculado es más favorable que el precio actual (validación de sanidad en L912-919 del bridge).

---

#### 7. `calculate_crt_targets()` (`crt_logic.py` L255-267)

Targets basados en la geometría del rango H4:

```python
eq   = crt_low + 0.5 * (crt_high - crt_low)   # Equilibrium = 50% del rango
tp1  = eq                                        # Primer objetivo (cierre parcial aquí)
tp2  = crt_low  if direction == "SELL" else crt_high   # Extremo opuesto (objetivo final)
```

Cuando `use_crt_targets=True`:
- `tp_price` se establece en `tp2` para la orden inicial.
- `_crt_eq_target[symbol] = tp1` se almacena para el monitor de cierre parcial en EQ.

---

#### 8. `check_smt_divergence()` (`crt_logic.py` L241-244)

```python
def check_smt_divergence(primary_swept: bool, correlated_swept: bool) -> bool:
    return primary_swept and not correlated_swept
```

Divergencia institucional: si **solo el par primario** barró su nivel y el correlacionado **no** → es una trampa genuina. Si **ambos** barrieron → movimiento por flujo macro, no trampa. El scanner verifica `EURUSD↔GBPUSD` (L845-863): si no hay divergencia, emite `DISMISSED` con razón `SMT: sin divergencia institucional`.

---

#### 9. Multiplicadores de lotaje TBS/TWS (`mt5_bridge.py` L935-939)

```python
if sweep_type and CRT_LOGIC_AVAILABLE:
    multiplier = bot_config.model_tbs_risk_multiplier if sweep_type == "TBS" else bot_config.model_tws_risk_multiplier
    volume = round(volume * multiplier, 2)
    volume = max(volume, 0.01)  # piso de seguridad
```

- TBS (cuerpo fuera del rango, mayor certeza) → `model_tbs_risk_multiplier` (default 1.0x).
- TWS (solo mecha, menor certeza) → `model_tws_risk_multiplier` (default 0.5x).
- El `max(volume, 0.01)` previene que un multiplicador `0.0` envíe un lote de cero, que rechazaría MT5.

---

#### 10. Comment enriquecido en órdenes — `_build_crt_comment()` (`mt5_bridge.py` L653-661)

```python
def _build_crt_comment(sweep_type, sweep_confidence) -> str:
    parts = ["CRT"]
    if sweep_type:   parts.append(f"sweep:{sweep_type}")
    if confidence:   parts.append(f"conf:{sweep_confidence:.2f}")
    parts.append(f"kz:{get_active_killzone_name()}")
    return "|".join(parts)[:31]   # límite de 31 chars de MT5
```

Ejemplo de output: `CRT|sweep:TBS|conf:1.00|kz:london`

Esto reemplaza el anterior comment genérico `Auto SELL Reversal`. El comment enriquecido permite a `send_trade_history()` reconstruir el `crt_meta` de cada deal cerrado, habilitando el desglose de métricas TBS vs TWS en la tabla de historial.

---

#### 11. `get_active_killzone_name()` (`mt5_bridge.py` L628-649)

Helper puro que retorna `"london"`, `"newyork"`, `"asian"`, `"overlap"` o `"none"` según la hora Canaria actual y las killzones activas en `bot_config`. Usa `_to_canary()` internamente. Necesario tanto para `_build_crt_comment()` como para futuros logs de análisis.

---

#### 12. Validación `maxPositions` total (`mt5_bridge.py` L688-694)

```python
if bot_config.max_positions > 0:
    all_positions = mt5.positions_get()
    total_open = len(all_positions) if all_positions else 0
    if total_open >= bot_config.max_positions:
        await asyncio.sleep(1.0)
        continue
```

El scanner ahora sale del ciclo completo (no solo del símbolo) si el total de posiciones abiertas alcanza el límite configurado. Esto incluye posiciones manuales, lo cual es una decisión conservadora deliberada (bloqueo como piso de seguridad).

> ⚠️ Limitación conocida: cuenta posiciones manuales. La discriminación por comment `CRT` sigue pendiente (ver Problemas Conocidos).

---

#### 13. Cierre parcial en EQ + SL a Breakeven (`mt5_bridge.py` L1094-1120)

Variables de control:

```python
_crt_eq_target: dict = {}   # { symbol: precio_eq }
_eq_done: set = set()        # tickets ya parcialmente cerrados
```

Lógica en `positions_broadcaster()` (evaluada a ~1Hz):

```python
for pos in positions:
    eq_price = _crt_eq_target.get(pos.symbol)
    if not eq_price or pos.ticket in _eq_done: continue
    
    hit_eq = (pos.type == BUY  and current >= eq_price) or
             (pos.type == SELL and current <= eq_price)
    
    if hit_eq:
        vol_cerrar = round(pos.volume * (bot_config.partial_close_pct / 100), 2)
        if vol_cerrar >= 0.01:
            mt5.order_send(cierre_parcial)             # cierra X% del volumen
            mt5.order_send({"sl": pos.price_open})    # mueve SL a breakeven
            _eq_done.add(pos.ticket)
```

**Purga de `_eq_done`:** al final del ciclo se hace `_eq_done &= {t.ticket for t in positions}`, eliminando tickets de posiciones ya cerradas para no crecer indefinidamente.

---

#### 14. Risk Guard conectado a `maxDailyLoss` de la UI (`mt5_bridge.py` L1252-1281)

```python
effective_daily_loss_pct = (
    bot_config.max_daily_loss
    if bot_config.max_daily_loss > 0
    else risk_config.get("max_daily_loss_pct", 4.5)   # fallback a config_crt.json
)
effective_total_loss_pct = (
    bot_config.max_daily_loss * 2    # convención: total = 2× diario
    if bot_config.max_daily_loss > 0
    else risk_config.get("max_total_loss_pct", 8.0)
)
```

La flag `_risk_guard_logged` impide que el mensaje de log de límites efectivos se repita en cada tick (spam a 10Hz).

---

#### 15. `send_trade_history()` — Sistema de Historial Real (`mt5_bridge.py` L1363-1490)

Fuente de datos: `mt5.history_deals_get(date_from, date_to)` con ventana configurable (default 30 días).

**Procesamiento por deal:**

1. Filtra solo deals de **cierre** (`entry in (1, 2)`).
2. Empareja con el deal de apertura usando `position_id`.
3. Calcula `duration_s = d.time - open_deal.time`.
4. **Clasifica origen** por comment:
   - Empieza con `CRT` o contiene `scanner` → `"bot"`
   - Contiene `CRT_EQ_PARTIAL` → `"bot_partial"`
   - Resto → `"manual"`
5. Calcula **pips** según `DEAL_TYPE` y `pip_value` del símbolo.
6. Parsea `crt_meta` del comment enriquecido (split por `|`).
7. Recupera SL/TP originales desde `mt5.history_orders_get()` por `position_id`.

**Métricas calculadas y enviadas:**

```
total, wins, losses, win_rate, total_profit, total_pips,
avg_win, avg_loss, profit_factor, avg_duration_s, max_dd_trade,
bot_trades, manual_trades, tbs_count, tbs_wr, tws_count, tws_wr
```

El campo `tbs_wr` / `tws_wr` requiere que el comment de la orden haya sido generado con `_build_crt_comment()` (contiene `sweep:TBS` o `sweep:TWS`). Trades anteriores a esta sesión mostrarán `tbs_count=0`.

**Frecuencia de envío:** `history_full` al conectar un nuevo cliente y en broadcast cada 30s (6 iteraciones × 5s en `feedback_loop_task`).

---

#### 16. Nuevos tipos e interfaces en `trading-store.ts`

**`ScannerSignal`** — Señal emitida por el scanner del bridge:

```typescript
interface ScannerSignal {
  id: string;                                           // único: symbol-action-timestamp-random
  action: "DETECTED" | "DISMISSED" | "EXECUTED" | "FAILED";
  symbol: string;
  direction?: string;
  price?: number;
  reason?: string;
  message?: string;
  timestamp: number;
}
```

**`HistoryTrade`** — Trade real de MT5 con clasificación de origen:

```typescript
interface HistoryTrade {
  ticket: number; symbol: string; direction: "BUY" | "SELL";
  volume: number; open_price: number; close_price: number;
  open_time: string; close_time: string; duration_s: number;
  profit: number; pips: number; commission: number; swap: number; net_profit: number;
  origin: "bot" | "bot_partial" | "manual";
  comment: string; sl: number; tp: number;
  crt_meta?: Record<string, string>;
}
```

**`TradeMetrics`** — Métricas agregadas:

```typescript
interface TradeMetrics {
  total: number; wins: number; losses: number; win_rate: number;
  total_profit: number; total_pips: number; avg_win: number; avg_loss: number;
  profit_factor: number; avg_duration_s: number; max_dd_trade: number;
  bot_trades: number; manual_trades: number;
  tbs_count: number; tbs_wr: number; tws_count: number; tws_wr: number;
}
```

**Acciones nuevas en el store:**
- `setTradeHistory(trades)` — reemplaza el historial completo (usado por `history_full`).
- `setTradeMetrics(metrics)` — guarda el objeto de métricas calculadas.
- `addScannerSignal(signal)` — prepend con cap a 100 señales (`slice(0, 100)`).

**Nuevos campos en `BotConfig`** (flags CRT avanzados con default `false`):
`requireCandleConfirmation`, `useDynamicSl`, `useCrtTargets`, `partialCloseAtEq`, `smtDivergenceEnabled`.

---

#### 17. Handlers nuevos en `mock-feed.ts`

```typescript
} else if (data.type === "history_full") {
    // Reemplaza tradeHistory con historial real de MT5 + métricas
    useTradingStore.getState().setTradeHistory(data.trades || []);
    if (data.metrics) useTradingStore.getState().setTradeMetrics(data.metrics);

} else if (data.type === "scanner_signal") {
    // Construye ScannerSignal y lo añade al panel ScannerLog
    useTradingStore.getState().addScannerSignal({
        id: `${data.symbol}-${data.action}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        action: data.action ?? "DETECTED",
        symbol: data.symbol ?? "?",
        direction: data.direction, price: data.price,
        reason: data.reason, message: data.message,
        timestamp: Date.now(),
    });
}
```

El `id` aleatorio con `Math.random().toString(36)` previene colisiones de keys en React cuando dos señales del mismo símbolo llegan en el mismo millisegundo.

---

#### 18. Fixes de escala de precios en `PriceChart.tsx`

**[UI-FIX-1] `priceFormat` con 5 decimales** para velas y todas las EMAs:

```typescript
const emaPriceFormat = { type: "price" as const, precision: 5, minMove: 0.00001 };
// Aplicado a: CandlestickSeries + ema20/50/200 + ema9/21
```

**[UI-FIX-1] `localization.priceFormatter`:**

```typescript
localization: { priceFormatter: (price: number) => price.toFixed(5) }
```

Asegura que el tooltip y la crosshair muestren 5 decimales (`1.08542`) en lugar de 2 (`1.09`), crítico para pares Forex.

**[UI-FIX-3] `scaleMargins` y `minimumWidth`:**

```typescript
rightPriceScale: {
    ticksVisible: true,
    minimumWidth: 65,
    scaleMargins: { top: 0.1, bottom: 0.1 }
}
```

Añade padding del 10% arriba y abajo para que los niveles extremos de las EMAs no queden cortados por el borde.

---

#### 19. Arquitectura IStrategy Pluggable (`strategies/base_strategy.py`, `strategies/crt_strategy.py`)

**Interfaces abstractas:**

```python
# base_strategy.py
class IStrategy(ABC):
    name: str = "base"
    @abstractmethod
    def evaluate(self, ctx: MarketContext) -> StrategySignal: ...
    def on_trade_closed(self, profit: float, setup_context: dict): ...

@dataclass
class MarketContext:
    symbol: str; bid: float; ask: float; spread_points: float
    atr_pips: float; crt_high: float; crt_low: float; eq: float
    anchor_time: str; candles_m1: list

@dataclass
class StrategySignal:
    approved: bool; direction: str; reason: str
    sweep_type: str = ""; confidence: float = 0.0
    sl_price: float = 0.0; tp1_price: float = 0.0; tp2_price: float = 0.0
    lot_multiplier: float = 1.0
```

**Registro por decorador:**

```python
STRATEGY_REGISTRY: dict[str, IStrategy] = {}

def register_strategy(cls):
    STRATEGY_REGISTRY[cls.name] = cls()
    return cls

@register_strategy
class CRTStrategy(IStrategy):
    name = "crt"
    def evaluate(self, ctx) -> StrategySignal: ...
```

**`CRTStrategy.evaluate()`** integra: `classify_sweep_type()`, `calculate_dynamic_sl()`, `calculate_crt_targets()`. Es la primera estrategia concreta del registry.

**Estado:** Registrada correctamente. El scanner (`strategy_scanner_task`) **aún NO** la invoca — sigue usando la lógica inline. La migración `scanner → IStrategy` es el siguiente paso (P3 de Prioridad Media).

---

#### 20. Scripts de herramienta: `verify_crt_behavior.py`

Script de simulación local que no requiere MT5. Prueba directamente las funciones de `crt_logic.py` con datos sintéticos para los 4 casos de TBS/TWS:

```python
# Caso 1: TBS limpio (body_ratio < 20%)
vela_2 = {"open": 1.0810, "high": 1.0820, "close": 1.0808, "low": 1.0805, "time": T}
# → Esperado: TBS con confidence=1.00
```

Permite verificar que `classify_sweep_type()` y `calculate_dynamic_sl()` dan el output esperado antes de conectar al bot real.

---

### Commit `8e7ac83` — docs: update technical documentation to v3.0 + UI fixes

**Alcance:** 3 archivos, +178 / -49 líneas.

---

#### 21. Fix sticky header opaco en `HistoryTable.tsx` — `[HISTORY-FIX-4]`

**Problema:** El `<thead>` usaba `className="... sticky top-0 z-10"` a nivel de elemento `<tr>` / contenedor, pero Tailwind CSS aplica `sticky` de forma efectiva **solo** cuando está en cada celda individual `<th>`. Resultado: las filas de datos se veían "transparentes" a través del header al hacer scroll.

**Causa técnica:** La especificación de `position: sticky` en CSS requiere que el elemento sticky tenga sus propios bordes definidos. Un `<thead>` sticky sin fondo explícito en cada `<th>` permite que los elementos debajo se pinten sobre él.

**Fix aplicado:**

```tsx
// Antes:
<thead className="... sticky top-0 z-10">
  <tr>
    <th className="px-4 py-3">Ticket</th>

// Después:
<thead className="text-xs text-zinc-500 uppercase">
  <tr>
    <th className="sticky top-0 z-20 bg-zinc-950 px-4 py-3 border-b border-zinc-800">Ticket</th>
```

Cambios clave por celda:
- `sticky top-0` en cada `<th>` → aplica sticky correctamente.
- `z-20` → z-index superior a cualquier contenido de fila (`z-10`).
- `bg-zinc-950` → fondo sólido opaco que tapa las filas al hacer scroll.
- `border-b border-zinc-800` → separador visual entre header y datos.
- Se añadió `border-collapse` al `<table>` para que los bordes de celdas sean contiguos.

---

#### 22. Script de auditoría `audit_crt.py`

Cliente WebSocket especializado que escucha `BOT_CONFIG_UPDATE` del bridge y produce un informe de estado de la metodología CRT en tiempo real:

```
══════════════════════════════════════════════════
AUDITORÍA DE METODOLOGÍA CRT
══════════════════════════════════════════════════

── DETECCIÓN DE SWEEP ──
  Confirmación por vela:    ❌ OFF → sweep por tick (1 solo tick)
  Multiplicador TBS:        1.0x (NO se aplica sin confirmación)
  Multiplicador TWS:        0.5x (NO se aplica sin confirmación)

── GESTIÓN DE RIESGO ──
  SL dinámico (mecha):      ❌ OFF → SL fijo en pips
  Targets CRT (EQ/extremo): ❌ OFF → TP fijo en pips
  Cierre parcial en EQ:     ❌ OFF → sin cierre parcial
  Trailing stop:            ❌ DECORATIVO (sin lógica implementada)

── RESUMEN ──
  ❌ CRT NO ACTIVO — el bot opera con sweep por tick y SL/TP fijos
     Para activar CRT real, enciende en la UI:
     1. Confirmación por Vela (TBS/TWS)
     2. Usar SL Dinámico
     3. Usar Objetivos CRT
══════════════════════════════════════════════════
```

Diferencia con `diagnostic_crt.py`: mientras `diagnostic_crt.py` muestra el estado del mercado (ticks, anchors, señales), `audit_crt.py` muestra qué features del bot están **realmente activas** vs cuáles son decorativas — útil para verificar la configuración antes de operar en LIVE.

---

### Resumen de archivos modificados hoy

| Archivo | Tipo de cambio | Impacto |
|---------|---------------|---------|
| `mt5_bridge.py` | +421 / -0 líneas | Timezone unificado, flags CRT, buffer sweep, cierre parcial EQ, Risk Guard ↔ UI, historial real, comments enriquecidos, helpers kz/comment |
| `crt_logic.py` | +54 líneas | `classify_sweep_type`, `check_smt_divergence`, `calculate_dynamic_sl`, `calculate_crt_targets` |
| `context_engine.py` | +11 / -0 líneas | Discriminación direccional (token triplicado BUY/SELL en queries y en registro de feedback) |
| `src/lib/store/trading-store.ts` | +105 / -0 líneas | Tipos `ScannerSignal`, `HistoryTrade`, `TradeMetrics`; flags CRT en `BotConfig`; acciones `setTradeHistory`, `setTradeMetrics`, `addScannerSignal` |
| `src/lib/data/mock-feed.ts` | +20 / -0 líneas | Handlers `history_full` y `scanner_signal` |
| `src/components/chart/PriceChart.tsx` | +23 / -0 líneas | `priceFormat` 5 decimales, `localization.priceFormatter`, `scaleMargins`, `minimumWidth` |
| `src/components/history/HistoryTable.tsx` | +22 / -20 líneas | Fix sticky opaco: `sticky`/`bg-zinc-950`/`z-20`/`border-b` por celda `<th>` |
| `src/components/history/HistoryRow.tsx` | refactor | Ajuste menor para HistoryTrade |
| `src/components/scanner/ScannerLog.tsx` | +74 líneas | Panel de señales del scanner (nuevo componente) |
| `src/components/layout/LeftSidebar.tsx` | +95 / -0 líneas | Flags CRT en el modal de configuración |
| `src/components/positions/PositionsTable.tsx` | +4 líneas | Ajuste menor |
| `src/components/layout/BottomPanel.tsx` | +3 líneas | Ajuste menor |
| `strategies/base_strategy.py` | +44 líneas | `IStrategy`, `MarketContext`, `StrategySignal`, `STRATEGY_REGISTRY`, `@register_strategy` |
| `strategies/crt_strategy.py` | +24 líneas | `CRTStrategy` (primera implementación) |
| `verify_crt_behavior.py` | +136 líneas | Suite de tests unitarios locales para `crt_logic.py` |
| `diagnostic_crt.py` | +86 líneas | Cliente WS de diagnóstico de mercado |
| `audit_crt.py` | +101 líneas | Cliente WS de auditoría de configuración CRT activa |
| `CRT optimizado.md` | +58 líneas | Referencia metodológica de la estrategia CRT institucional |

---

### Prioridad Alta
- **P1 — Reintentar rangos estructurales + bias direccional con micro-prompts aislados:** Reimplementar la especificación de "rangos estructurales con bias" (ver sección "Intento Fallido") dividida en micro-prompts pequeños y verificables uno a uno. Lección clave: el prompt monolítico falló y fue rechazado por completo.
- **P1b — ✅ Fix ChromaDB discriminación símbolo/dirección (COMPLETADO 11 jun tarde):** Resuelto con colecciones por símbolo + filtro `where` por símbolo y dirección. Tanto la discriminación direccional como la de símbolo están implementadas.
- **P2 — Verificar pipeline completo con flags CRT activos:** Probar end-to-end con `require_candle_confirmation`, `use_dynamic_sl`, `use_crt_targets`, `smt_divergence_enabled` y `partial_close_at_eq` encendidos (usar `verify_crt_behavior.py` / `diagnostic_crt.py`).
- **P2b — Handlers `risk_guard_alert` / `anchor_update` y filtro de manuales:** Cablear los handlers faltantes en `mock-feed.ts` y hacer que el bloqueo del scanner filtre posiciones por comment `CRT`.

### Prioridad Media
- **P3 — Conectar selector de estrategia a `STRATEGY_REGISTRY`:** Migrar `strategy_scanner_task()` a `IStrategy` / `CRTStrategy`.
- **P4 — Trailing stop, confluencia M1/M15, UI del optimizador:** Implementar las features decorativas restantes.
- **Panel de evaluación CRT en tiempo real:** Semáforo por fase del scanner.

### Prioridad Baja
8. **Walk-forward analysis:** Validación de robustez con ventanas in-sample/out-sample.
9. **Multi-símbolo en backtest:** Ejecución paralela sobre varios pares.
10. **Alertas sonoras:** Notificaciones de audio para trades y Risk Guard.
11. **Slippage y comisiones:** Simulación realista de costos de trading en el backtester.
