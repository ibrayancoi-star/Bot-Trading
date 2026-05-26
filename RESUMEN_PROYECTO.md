# Documentación y Resumen del Proyecto: Dashboard de Trading Híbrido

## 💡 Idea Central del Desarrollo
El proyecto consiste en la creación de una plataforma de trading avanzada (tipo TradingView) orientada a ofrecer un entorno visual premium, analítica de mercado y ejecución de órdenes en un solo lugar, con un sistema de inteligencia artificial y contexto.

### Arquitectura Híbrida:
1. **Frontend (Panel de Monitoreo Visual - Next.js)**: Conserva la interfaz premium y el estado reactivo ya construidos. Se conecta a un servidor WebSocket local administrado por Python para pintar gráficos y métricas de la cuenta de forma reactiva y ultrarrápida.
2. **Backend/Motor de Ejecución (Python + MT5)**: Un script en segundo plano (`mt5_bridge.py`) que corre localmente, se conecta de manera nativa a la terminal de escritorio de MetaTrader 5 (MT5), extrae ticks en tiempo real, procesa la lógica de las estrategias, ejecuta el control de riesgo y envía las órdenes al broker.
3. **Módulo de Contexto e Inteligencia (ChromaDB + NLP)**: Un motor de contexto basado en la base de datos vectorial ChromaDB y Transformers que procesa un reglamento en lenguaje natural, filtra operativas por contexto semántico y se retroalimenta automáticamente de las operaciones fallidas.

Esta arquitectura híbrida reemplaza el plan original de conexión externa a cTrader, eliminando las restricciones de KYC, optimizando presupuesto y facilitando el uso de cualquier cuenta demo o real tradicional abierta en la aplicación de escritorio de MT5.

---

## 🏗️ Implementaciones Realizadas

### 1. Infraestructura y Arquitectura Base (Next.js)
- **Framework Core**: Implementado sobre **Next.js 16** (App Router) y React 19.
- **Estilos y UI**: Configuración de Tailwind CSS v4, `shadcn/ui` y `@base-ui/react` para componentes interactivos y un diseño de vanguardia.
- **Motor de Gráficos**: Integración de **Lightweight Charts** (`lightweight-charts` v5) en el componente `PriceChart.tsx` para renderizar de manera asíncrona velas y líneas de precios en tiempo real sin caídas de rendimiento.

### 2. Puente Asíncrono de Python & MetaTrader 5 (`mt5_bridge.py`)
- **Enlace de Datos Nativo**: Conexión directa a la terminal local de MT5 abierta en Windows a través de la librería oficial `MetaTrader5`.
- **Servidor WebSocket Local**: Servidor de alta velocidad basado en `websockets` en `ws://127.0.0.1:8000` diseñado para servir datos locales en JSON.
- **Streaming de Cotizaciones (Market Data)**: Bucle asíncrono optimizado de alta frecuencia (10Hz) que consulta precios bid/ask para los pares **EURUSD** y **GBPUSD**, transmitiéndolos a los clientes web activos inmediatamente solo cuando hay cambios.
- **Sincronización Financiera (Account Info)**: Transmisión en vivo y periódica del estado de la cuenta (balance, equidad, margen, apalancamiento, servidor y número de cuenta) inmediatamente al conectar y en cada actualización de equidad.
- **Resiliencia de Conexión**: Bucle de verificación persistente para reconectar con MT5 en caso de caídas de la terminal y prevención de apertura forzada.
- **Múltiples Modos de Llenado (Filling Modes)**: Soporte para múltiples Filling Modes (IOC, FOK, RETURN) de forma secuencial y transparente para adaptarse a cualquier tipo de broker (Demo/Real/Fondeo).
- **Detección Inteligente de Cuentas**: Detección automática del tipo de cuenta (`fondeo`, `real` o `demo`) mediante la lectura del servidor y palabras clave (`ftmo`, `funding`, `prop`, etc.).

### 3. Módulo de Contexto y Base de Datos Vectorial (`context_engine.py`)
- **Base Vectorial (ChromaDB)**: Integración de ChromaDB en local (`./chroma_db`) para almacenar el reglamento de trading ("crt_rules_curated.md") y la experiencia de trading en formato semántico.
- **Procesamiento de NLP**: Uso del modelo `sentence-transformers/all-MiniLM-L6-v2` para vectorización 100% offline.
- **Capas de Reglas**: 
  - **Capa 1 (Hard Rules)**: Filtros deterministas en `mt5_bridge.py` por zona horaria ("Atlantic/Canary"), Killzones (London, NY), y spread máximo (ratio Spread/ATR).
  - **Capa 2 (Semántica)**: Validación pre-trade evaluando la similitud del setup propuesto frente al reglamento aceptado.
  - **Capa 3 (Exclusión y Feedback Loop)**: Sistema de autoaprendizaje que monitorea el historial de MetaTrader (cada 5 segs). Cuando un trade resulta en `LOSS`, se inyecta su contexto semántico como una regla de *exclusión* para bloquear futuras operativas similares.

### 4. Adaptación del Frontend y Zustand Store
- **Feed Integrado (`mock-feed.ts`)**: Adaptado para conectarse directamente a `ws://127.0.0.1:8000`. Procesa y agrega los ticks en tiempo real en velas de 1 minuto para inyectarlas directamente al gráfico (`PriceChart.tsx`).
  - **Sincronización Inteligente de Cuenta**: La pestaña del switch se autoselecciona la primera vez que se carga la página o si físicamente cambias de cuenta en MT5 (según login/server), permitiendo al usuario cambiar y permanecer manualmente en la pestaña elegida sin molestas reversiones.
- **Persistencia Reactiva (`trading-store.ts`)**: Mapeo completo de las métricas recibidas de MT5 para actualizar el balance, equidad, margen libre y evaluar en vivo los cortacircuitos de Drawdown. Añadida la opción de cuenta `demo` en la lógica de estado.
- **Widget Superior e Inputs**: Selector completo de tres opciones (Real / Fondeo / Demo) y campos configurables para Lotaje, Take Profit (TP) y Stop Loss (SL).
- **Líneas de Precios en Gráfico**: Representación visual de posiciones activas incluyendo nivel de entrada con PnL dinámico flotante, líneas punteadas de TP y SL directo en el gráfico.

### 5. Módulo Risk Guard (Cortacircuitos de Pérdida)
- **Monitoreo de Drawdown (10Hz)**: Bucle en segundo plano integrado directamente en la difusión de ticks que calcula en tiempo real la equidad contra el balance inicial del día (`daily_starting_balance`) y total.
- **Configuración de Umbrales**: Lectura de parámetros de protección (`max_daily_loss_pct` y `max_total_loss_pct`) desde la sección `risk_management` en `config_crt.json`.
- **Cierre de Pánico Integrado**: Cierre instantáneo y asíncrono de todas las posiciones abiertas en MT5 si se exceden los límites para evitar deslizamiento de precios (slippage).
- **Bloqueo Operativo Absoluto**: Bloqueo del envío de órdenes desde el puente y desactivación de operaciones hasta el reinicio diario del balance, además del envío de alertas websocket de emergencia (`risk_guard_alert`).

### 6. Optimización de Gráficos e Indicadores
- **Cálculo en Backend (10Hz)**: Implementado el cálculo en tiempo real de EMA 9, EMA 21, RSI 14 y MACD (12, 26, 9) en `mt5_bridge.py` en base a los precios bid/ask consultados de MT5.
- **Transmisión de Indicadores**: Actualización del payload del WebSocket para incluir los valores numéricos calculados del backend en el evento `tick`.
- **Renderizado de EMAs**: Inyección dinámica en Lightweight Charts de las líneas de EMA 9 (azul `#38bdf8`) y EMA 21 (rojo/naranja `#f97316`) con anchos de línea de 1.5.
- **Sub-panel de Osciladores**: Creación de una barra flotante premium en el gráfico de la web UI para mostrar los valores en tiempo real del RSI (con alertas de color reactivo para sobrecompra/sobreventa) y de las líneas/histograma de MACD.

### 7. UI de Historial Extendida (Experiencia de ChromaDB)
- **Servicio Fullstack**: Canalización de las experiencias del Feedback Loop de ChromaDB en tiempo real hacia el frontend mediante los eventos `history_init` (carga inicial masiva de las últimas 20 operaciones) y `history_update` (actualizaciones reactivas tras cada cierre de posición).
- **Componente HistoryPanel**: Panel interactivo premium con KPIs cuantitativos en vivo (Win Rate, Pips Netos, Relación W/L) y filas expandibles para revelar los diagnósticos y reflexiones semánticas almacenadas por el motor de IA.
- **Navegación por Pestañas**: Reestructuración del panel inferior (`BottomPanel.tsx`) con tabs reactivas tipo TradingView que integran insignias de conteo dinámico sobre posiciones activas e historial.

### 8. Escáner de Estrategia Automatizado (Strategy Scanner Loop)
- **Monitoreo de Velas de Anclaje (HTF)**: Bucle persistente que calcula los rangos clave de referencia de MetaTrader 5 (CRT High, CRT Low y Equilibrium EQ) al cierre de las velas definidas en Canarias (06:00, 10:00, 14:00), alineadas matemáticamente con la sesión de Nueva York.
- **Soporte Multi-Par Simultáneo**: El escáner evalúa oportunidades de manera concurrente, detectando y ejecutando posiciones en **EUR/USD** y **GBP/USD** al mismo tiempo.
- **Detección de Barridos (Sweeps) en Tiempo Real**: Escaneo continuo de precios a 1Hz. Cuando la cotización rompe los extremos en una Killzone activa, pre-activa la alerta de barrido de liquidez.
- **Ejecución y Disparo Autónomo**: Si las reglas duras (Capa 1) y de contexto vectorial (Capa 2/3) se aprueban, realiza el envío automático de la orden (`order_send`) con Stop Loss adaptado y Take Profit objetivo en el Equilibrium (EQ), informando del estado de cada señal (DETECTED, DISMISSED, EXECUTED) al frontend por WebSocket.

---

## 🚀 Estado del Proyecto (Actualizado Mayo-2026)

| Área | Estado | Detalle |
| :--- | :---: | :--- |
| **Frontend UI** | ✅ COMPLETO | Switch de 3 cuentas, inputs interactivos de trading en panel lateral, visualización de métricas y balance/equity reactivo. |
| **Integración de Gráfico** | ✅ COMPLETO | Conexión a Lightweight Charts asíncrona, velas en vivo y líneas visuales de órdenes activas (Precio, SL, TP). |
| **Soporte Multi-Símbolo** | ✅ COMPLETO | Integración bidireccional y actualización dinámica en tiempo real de gráficos e historial para EUR/USD y GBP/USD desde MT5. |
| **Detección de Cuenta** | ✅ COMPLETO | Detección automática basada en nombre de servidor broker y trade mode de MT5 (Demo/Real/Fondeo). |
| **Ejecución y Modificación** | ✅ COMPLETO | Soporte nativo para órdenes BUY, SELL y cancelación con fallback inteligente de Filling Modes (IOC -> FOK -> RETURN). |
| **Persistencia del Switch** | ✅ COMPLETO | Control absoluto del usuario sobre el switch de cuenta sin reinicios cíclicos automáticos. |
| **Módulo de Contexto** | ✅ COMPLETO | Motor ChromaDB integrado offline. Reglas curadas importadas (Capa 1 y Capa 2/3). |
| **Feedback Loop (IA)** | ✅ COMPLETO | Tarea asíncrona en `mt5_bridge.py` que registra resultados de trades y genera exclusiones automáticas de setups fallidos. |
| **Módulo Risk Guard** | ✅ COMPLETO | Cortacircuitos de Drawdown en tiempo real (10Hz) con cierre de pánico de posiciones y bloqueo de operativas. |
| **Optimización de Indicadores** | ✅ COMPLETO | Renderizado dinámico de EMA 9/EMA 21 y barra de estado flotante para osciladores RSI y MACD. |
| **UI de Historial Extendida** | ✅ COMPLETO | Panel inferior con pestañas, badges de conteo y renderizado de diagnósticos del Feedback Loop. |
| **Escáner Autónomo** | ✅ COMPLETO | Detección de barridos H4, validaciones multicapa automáticas y ejecución directa en MT5 sin intervención humana. |

---

## 🚀 Siguientes Pasos
1. **Visualización de Alertas del Escáner en UI**: Incorporar una consola o log flotante en la interfaz web para pintar las notificaciones del escáner en tiempo real (`scanner_signal`).
2. **Backtesting Semántico**: Desarrollar scripts de simulación históricos para calibrar la distancia vectorial idónea en ChromaDB.
3. **Verificación de Lecciones IA**: Verificar la persistencia real de las lecciones en `crt_rules_curated.md` si se requieren ajustes en los prompts de IA.
4. **Pruebas en Vivo**: Ejecutar el entorno completo (`npm run dev` y `python mt5_bridge.py`) para probar la interacción final del usuario y el sistema.

---

## 📝 Notas Técnicas Importantes
- **Arquitectura de Sincronización**: `mt5_bridge.py` actúa como orquestador (backend WebSocket). `mock-feed.ts` es el singleton central (frontend) que conecta el WebSocket al store de Zustand (`trading-store.ts`).
- **Concurrencia**: Las consultas bloqueantes a ChromaDB y MT5 utilizan `asyncio.run_in_executor` para no detener el event loop del WebSocket.
- **Prevención de Duplicados**: La lógica del Feedback Loop utiliza `processed_deals` en `mt5_bridge.py` para evitar registros duplicados de operaciones cerradas en la base de datos vectorial (ChromaDB).
