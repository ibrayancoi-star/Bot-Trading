# Integración con cTrader Open API v2

Este documento detalla el mapa de ruta técnico para transicionar nuestra actual API simulada (`/api/orders`) hacia el ecosistema real de cTrader utilizando **Open API v2**.

## 1. Arquitectura de Conexión

cTrader ofrece dos métodos principales de integración:
1. **REST API**: Ideal para acciones simples y no dependientes de baja latencia (ej. obtener histórico de cuenta).
2. **Protocol Buffers (Protobuf) sobre WebSockets**: Requerido para feed de precios en tiempo real y ejecución de órdenes algorítmicas de baja latencia.

**Decisión Arquitectónica:** 
Para la Fase 4 del proyecto, utilizaremos la librería oficial o un cliente Protobuf/WebSocket en nuestro entorno de Node.js (Next.js API Routes / Backend de ejecución) para garantizar que las señales del bot se envíen de inmediato sin overhead de HTTP.

## 2. Autenticación (OAuth 2.0)

El proceso requerirá usar las variables del `.env.local`:
- Intercambiaremos el `CTRADER_CLIENT_ID` y `CTRADER_CLIENT_SECRET` por un Access Token (si el usuario autoriza la app).
- En el contexto de cuentas propietarias como *The Trading Pit (TTP)*, el Access Token provisto autorizará acciones exclusivamente sobre el `CTRADER_ACCOUNT_ID`.

### Endpoints (REST) / Mensajes (WS)

- **Autorización de la aplicación (WS):** `ProtoOAApplicationAuthReq` usando Client ID y Secret.
- **Autorización de cuenta (WS):** `ProtoOAAccountAuthReq` usando el Access Token y Account ID.

## 3. Reemplazo del Endpoint Mock (`/api/orders`)

Nuestro `StrategyRunner` y `RightSidebar` hacen solicitudes POST al middleware interno. El middleware deberá convertir estas acciones al protocolo Protobuf.

### 3.1 Apertura de Posiciones (Market Execution)

Actualmente procesamos `action: "OPEN"`.

**Mensaje cTrader:** `ProtoOANewOrderReq`
*   **Campos clave:**
    *   `ctidTraderAccountId`: (Leído del env)
    *   `symbolId`: ID numérico del símbolo EURUSD (obtenido mediante `ProtoOASymbolsListReq`).
    *   `orderType`: `MARKET` (1)
    *   `tradeSide`: `BUY` (1) o `SELL` (2)
    *   `volume`: Convertido de Lotes a Volumen base (ej. 1 Lote = 100,000 volumen).
*   **Respuesta esperada:** `ProtoOAExecutionEvent` con estado `ORDER_FILLED` o `ORDER_ACCEPTED`. Extraeremos el `positionId` para mapearlo en nuestro `trading-store.ts`.

### 3.2 Modificación de Posiciones (SL / TP)

Aunque por ahora ejecutamos posiciones directas, el motor de riesgo requerirá ajustar Stop Loss.

**Mensaje cTrader:** `ProtoOAAmendPositionSLTPReq`
*   **Campos clave:**
    *   `positionId`: El ID de la orden obtenido al abrir.
    *   `stopLoss`: Precio absoluto.
    *   `takeProfit`: Precio absoluto.

### 3.3 Cierre de Posiciones

Actualmente procesamos `action: "CLOSE"`.

**Mensaje cTrader:** `ProtoOAClosePositionReq`
*   **Campos clave:**
    *   `positionId`: El ID de la posición a cerrar.
    *   `volume`: El volumen total de la posición.
*   **Respuesta esperada:** `ProtoOAExecutionEvent` indicando `ORDER_FILLED` para la orden inversa generada, devolviendo el `closePrice` real.

## 4. Gestión de Fallos y Reconexión

1. **Latencia / Slippage**: El endpoint interno no devolverá el precio que asumió el cliente, sino el `executionPrice` del `ProtoOAExecutionEvent`. El frontend deberá reconciliar posibles diferencias de PnL.
2. **Ping / Pong**: El backend Next.js deberá mantener el socket activo enviando latidos (Heartbeats) `ProtoHeartbeatEvent` cada 20-30 segundos para evitar que cTrader cierre la conexión.

## 5. Implementación Futura (Hito)

1. Crear un servicio Singleton en el backend de Next.js (`src/lib/ctrader/client.ts`) para mantener la conexión WebSocket persistente.
2. Actualizar `src/app/api/orders/route.ts` para inyectar la instrucción al Singleton.
3. Propagar el evento de respuesta a través del endpoint HTTP de vuelta al `StrategyRunner`.
