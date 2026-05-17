# Documentación y Resumen del Proyecto: Dashboard de Trading Híbrido

## 💡 Idea Central del Desarrollo
El proyecto consiste en la creación de una plataforma de trading avanzada (tipo TradingView) orientada a ofrecer un entorno visual premium, analítica de mercado y ejecución de órdenes en un solo lugar.

### Arquitectura Híbrida:
1. **Frontend (Panel de Monitoreo Visual - Next.js)**: Conserva la interfaz premium y el estado reactivo ya construidos. Se conecta a un servidor WebSocket local administrado por Python para pintar gráficos y métricas de la cuenta de forma reactiva y ultrarrápida.
2. **Backend/Motor de Ejecución (Python + MT5)**: Un script en segundo plano (`mt5_bridge.py`) que corre localmente, se conecta de manera nativa a la terminal de escritorio de MetaTrader 5 (MT5), extrae ticks en tiempo real, procesa la lógica de las estrategias, ejecuta el control de riesgo y envía las órdenes al broker.

Esta arquitectura híbrida reemplaza el plan original de conexión externa a cTrader, eliminando las restricciones de KYC, optimizando presupuesto y facilitando el uso de cualquier cuenta demo tradicional abierta en la aplicación de escritorio de MT5.

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
- **Resiliencia de Conexión**: Bucle de verificación persistente para reconectar con MT5 en caso de caídas de la terminal.

### 3. Adaptación del Frontend y Zustand Store
- **Feed Integrado (`mock-feed.ts`)**: Adaptado para conectarse directamente a `ws://127.0.0.1:8000`. Procesa y agrega los ticks en tiempo real en velas de 1 minuto para inyectarlas directamente al gráfico (`PriceChart.tsx`).
- **Persistencia Reactiva (`trading-store.ts`)**: Mapeo completo de las métricas recibidas de MT5 para actualizar el balance, equidad, margen libre y evaluar en vivo los cortacircuitos de Drawdown (5% de pérdida diaria / 10% global).
- **Indicador de Conexión en Cabecera (`Header.tsx`)**: Reemplazo del botón "Conectar cTrader" por un widget premium que muestra en vivo el estado del puente MT5:
  - **Verde Pulsante**: Conexión activa con detalles de cuenta (`login` y `server`).
  - **Amarillo Pulsante**: Intentando conectar con el servidor local de Python.
  - **Rojo Estático**: Puente desconectado.

---

## 🚀 Siguientes Pasos
1. **Lógica de Ejecución de Órdenes**: Implementar en `mt5_bridge.py` los manejadores de eventos para procesar peticiones de compra/venta enviadas por el frontend y traducirlas a transacciones nativas de MT5 (`mt5.order_send`).
2. **Módulo Risk Guard**: Configurar el cortacircuitos en Python para proteger de forma absoluta las futuras evaluaciones de fondeo.
3. **Optimización de Gráficos e Indicadores**: Finalizar el binding de cálculos de indicadores técnicos en cliente (EMA, RSI, MACD) utilizando los flujos en vivo de MT5.
