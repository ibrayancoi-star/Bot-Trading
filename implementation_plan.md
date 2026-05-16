# Sistema de Automatización para The Trading Pit

Transformar el repositorio `tradingview-gratis` (actualmente un clon visual de TradingView para crypto con datos de Binance) en un **panel de control y automatización de estrategias** para cuentas de fondeo en The Trading Pit.

## Análisis del Estado Actual

### Lo que tenemos (reutilizable)

| Capa | Archivos | Valor |
|---|---|---|
| **Chart engine** | `PriceChart.tsx` (935 líneas) | Gráficos `lightweight-charts` v5 con velas, EMAs, RSI, MACD, volumen, herramientas de medición |
| **Data layer** | `binance/rest.ts`, `binance/ws.ts` | REST + WebSocket multiplex con auto-reconnect — sirve de **blueprint** para conectar a cualquier otro feed |
| **Indicadores** | `indicators/index.ts` | SMA, EMA, RSI (Wilder), MACD — cálculo client-side puro en TS |
| **Estado** | `chart-store.ts` | Zustand v5 con persist: símbolo, timeframe, indicadores, watchlist |
| **UI system** | 9 primitivos shadcn/ui + Tailwind v4 | Button, Dialog, DropdownMenu, Input, ScrollArea, Select, Separator, Tabs, Tooltip |
| **Layout** | Header, LeftSidebar, RightSidebar, BottomPanel | Shell tipo TradingView con paneles flexibles |
| **Store nuevo** | `trading-store.ts` | `PropAccount` + `TradePosition` + `isBotActive` (creado en paso anterior) |

### Lo que falta construir

El sistema actual es un **visor de precios crypto** read-only. Para automatizar una cuenta en The Trading Pit necesitamos:

1. **Motor de estrategias** — configurar, activar y monitorear estrategias de trading
2. **Integración con broker** — The Trading Pit opera vía cTrader, MT4/MT5, Rithmic o ATAS (no API directa)
3. **Gestión de riesgo** — enforcement de drawdown/profit target alineado con las reglas de la prop firm
4. **Panel de control** — dashboard para monitoreo, configuración y logs

---

## User Review Required

> [!IMPORTANT]
> **¿Qué plataforma de The Trading Pit usas?** TTP soporta cTrader, MT4, MT5, Rithmic y ATAS. La integración técnica cambia radicalmente según la plataforma:
> - **cTrader** → Open API (la más developer-friendly, permite cBots nativos)
> - **MT4/MT5** → Expert Advisors (EAs) + webhooks vía bridge
> - **Rithmic/ATAS** → Menor soporte de automatización
>
> El plan asume **un approach agnóstico** con webhook middleware, pero si usas cTrader podemos hacer una integración más directa.

> [!WARNING]
> **Reglas de The Trading Pit sobre automatización:**
> - ✅ EAs y bots propios permitidos
> - ✅ Copy trading entre tus propias cuentas (máx 5)
> - ❌ HFT prohibido
> - ❌ Copy trading de señales externas/otros traders prohibido
> - ⚠️ Verificar con soporte antes de deployar en cuenta fondeada
>
> El sistema que construyamos debe ser **tu propio bot con tu propia lógica**, no un copiador de señales.

> [!IMPORTANT]
> **Fuente de datos de mercado:** Actualmente el repo usa la API pública de Binance (crypto). ¿Quieres mantener Binance como feed de datos para el chart y ejecutar en TTP? ¿O necesitas datos de Forex/CFD/Futuros directamente? Esto afecta los pares disponibles y el tipo de instrumentos.

## Open Questions

1. **¿Qué plataforma de TTP usas?** (cTrader / MT5 / MT4 / Rithmic) — determina la capa de ejecución
2. **¿Qué instrumentos operas?** (Forex, índices, crypto, commodities) — determina el feed de datos
3. **¿Tienes cuenta en algún servicio bridge?** (TradersPost, Cwebhook, etc.) — o ¿prefieres un middleware propio con Next.js API routes?
4. **¿Cuál es tu cuenta actual?** (Fase 1 $50K/$100K, Fase 2, Fondeada) — para preconfigurar las reglas de riesgo correctas
5. **¿Qué tipo de estrategias quieres automatizar?** (trend following con EMAs, mean reversion con RSI, breakout, etc.) — para diseñar el motor de estrategias

---

## Proposed Changes

El plan se divide en **4 fases** incrementales. Cada fase es funcional por sí misma.

---

### Fase 1 — Capa de Estado y Tipos Fundacionales

Establecer todos los tipos TypeScript y stores de Zustand necesarios para el sistema completo.

#### [MODIFY] [trading-store.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/store/trading-store.ts)

Expandir el store existente con:
- `TTPAccountConfig` — reglas específicas por tipo de challenge (Fase 1/2, tamaño de cuenta)
- `TradeLog` — historial de trades cerrados con timestamp, duración, resultado
- `RiskMetrics` — daily P&L, current drawdown, remaining margin
- Acciones: `syncAccountFromAPI()`, `checkRiskLimits()`, `logTrade()`

#### [NEW] [strategy-store.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/store/strategy-store.ts)

Nuevo store para el motor de estrategias:
```typescript
interface StrategyConfig {
  id: string;
  name: string;
  type: 'ema-cross' | 'rsi-reversal' | 'macd-divergence' | 'custom';
  enabled: boolean;
  symbols: string[];
  timeframe: Timeframe;
  params: Record<string, number>;  // e.g. { fastPeriod: 9, slowPeriod: 21 }
  riskPerTrade: number;            // % del balance
  maxOpenPositions: number;
  stopLoss: number;                // pips o %
  takeProfit: number;              // pips o %
}

interface StrategyState {
  strategies: StrategyConfig[];
  activeStrategyId: string | null;
  signals: Signal[];              // historial de señales generadas
  // Actions
  addStrategy, removeStrategy, updateStrategy, activateStrategy
}
```

#### [NEW] [types/trading.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/types/trading.ts)

Tipos compartidos:
- `Signal` — señal generada por una estrategia (BUY/SELL/CLOSE, timestamp, confidence)
- `TTPChallenge` — configuración de reglas de TTP por tipo de challenge
- `BrokerConnection` — estado de conexión al broker (connected/disconnected/error)
- `TradeResult` — resultado de un trade cerrado

---

### Fase 2 — Motor de Estrategias (Client-Side)

Engine que evalúa condiciones de entrada/salida sobre datos de mercado en tiempo real.

#### [NEW] [strategies/index.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/strategies/index.ts)

Registro de estrategias y factory:
```typescript
interface StrategyEngine {
  evaluate(candles: Candle[], config: StrategyConfig): Signal | null;
  getRequiredPeriod(): number;
}
```

#### [NEW] [strategies/ema-cross.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/strategies/ema-cross.ts)

Estrategia de cruce de EMAs (fast/slow). Genera señal BUY cuando EMA rápida cruza por encima de EMA lenta, SELL cuando cruza por debajo.

#### [NEW] [strategies/rsi-reversal.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/strategies/rsi-reversal.ts)

Estrategia de reversión RSI. BUY cuando RSI sale de sobreventa (<30→arriba), SELL cuando sale de sobrecompra (>70→abajo).

#### [NEW] [strategies/macd-divergence.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/strategies/macd-divergence.ts)

Estrategia basada en cruce de MACD con línea de señal + confirmación con histograma.

#### [NEW] [engine/strategy-runner.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/engine/strategy-runner.ts)

Runner que:
1. Suscribe al WebSocket de datos
2. En cada vela cerrada, evalúa todas las estrategias activas
3. Genera señales y las despacha (log + webhook + UI)
4. Valida contra reglas de riesgo antes de emitir

---

### Fase 3 — Integración Broker / Webhook

Capa de comunicación con el broker de TTP.

#### [NEW] [broker/webhook.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/broker/webhook.ts)

Cliente webhook que envía señales al bridge (TradersPost, Cwebhook, o endpoint propio):
```typescript
async function sendSignal(signal: Signal, webhookUrl: string): Promise<boolean>
```

#### [NEW] [app/api/webhook/route.ts](file:///c:/Proyectos/tradingview-gratis-master/src/app/api/webhook/route.ts)

API Route de Next.js para recibir webhooks entrantes (e.g. confirmaciones de ejecución del broker, actualizaciones de posiciones). Esto permite tener nuestro propio middleware sin depender de servicios externos.

#### [NEW] [broker/adapter.ts](file:///c:/Proyectos/tradingview-gratis-master/src/lib/broker/adapter.ts)

Interfaz abstracta de broker adapter:
```typescript
interface BrokerAdapter {
  connect(): Promise<void>;
  placeOrder(order: OrderRequest): Promise<OrderResponse>;
  getPositions(): Promise<TradePosition[]>;
  getAccountInfo(): Promise<PropAccount>;
  disconnect(): void;
}
```
Con implementación inicial para webhook genérico. Preparado para agregar cTrader Open API, MT5 bridge, etc.

---

### Fase 4 — UI/Dashboard

Componentes visuales para monitoreo y control.

#### [MODIFY] [page.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/app/page.tsx)

Agregar sistema de tabs/views: `Chart` | `Dashboard` | `Strategies` | `Logs`

#### [NEW] [components/dashboard/AccountStats.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/components/dashboard/AccountStats.tsx)

Panel con métricas de la cuenta de fondeo:
- Balance / Equity con barra de progreso hacia profit target
- Daily drawdown gauge (rojo cuando se acerca al límite)
- Max drawdown gauge
- Status badge (Active / Passed / Failed)

#### [NEW] [components/dashboard/PositionsTable.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/components/dashboard/PositionsTable.tsx)

Tabla de posiciones abiertas con P&L en tiempo real, botón de cierre manual.

#### [NEW] [components/dashboard/TradeHistory.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/components/dashboard/TradeHistory.tsx)

Historial de trades cerrados con filtros y stats.

#### [NEW] [components/strategies/StrategyPanel.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/components/strategies/StrategyPanel.tsx)

Panel para crear, configurar y activar estrategias. Formulario con parámetros dinámicos según el tipo de estrategia.

#### [NEW] [components/strategies/SignalLog.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/components/strategies/SignalLog.tsx)

Feed en tiempo real de señales generadas por las estrategias con estado (pending → sent → executed → filled).

#### [NEW] [components/dashboard/RiskMonitor.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/components/dashboard/RiskMonitor.tsx)

Monitor de riesgo con:
- Alertas visuales cuando te acercas a los límites de drawdown
- Kill switch manual de emergencia
- Countdown de tiempo hasta cierre de mercado (si aplica)

#### [MODIFY] [Header.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/components/layout/Header.tsx)

Actualizar branding: "TradingView Gratis" → nombre del sistema. Agregar indicador de conexión al broker y toggle global del bot.

#### [MODIFY] [RightSidebar.tsx](file:///c:/Proyectos/tradingview-gratis-master/src/components/layout/RightSidebar.tsx)

Expandir para mostrar Account Stats + Positions por debajo del Watchlist, o como tabs alternativas.

---

## Verification Plan

### Automated Tests

```bash
# TypeScript compile check
npx tsc --noEmit

# Dev server boot
npm run dev

# Lint
npm run lint
```

### Manual Verification

1. **Fase 1**: Verificar que los stores se hidratan correctamente y los tipos compilan sin error
2. **Fase 2**: Ejecutar estrategias sobre datos históricos de Binance en el browser y validar que las señales generadas son correctas (backtesting visual)
3. **Fase 3**: Testear webhook endpoint con `curl` / Postman simulando señales
4. **Fase 4**: Verificar UI en browser — interacción de todos los paneles, responsive, estados de error

### Browser Testing

- Lanzar `npm run dev` y verificar visualmente cada componente nuevo
- Probar flujo completo: configurar estrategia → activar → ver señal en logs → verificar webhook enviado
- Testear edge cases: ¿qué pasa si el drawdown alcanza el límite? ¿Kill switch funciona?
