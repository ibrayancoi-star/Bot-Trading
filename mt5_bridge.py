import asyncio
import json
import logging
import sys
import MetaTrader5 as mt5
import websockets

# Configuración de Logs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("MT5Bridge")

# Estado de Conexiones
CONNECTED_CLIENTS = set()
MT5_INITIALIZED = False

# Últimos ticks conocidos para evitar envíos redundantes
last_ticks = {
    "EURUSD": {"bid": 0.0, "ask": 0.0},
    "GBPUSD": {"bid": 0.0, "ask": 0.0}
}

async def check_mt5_connection():
    """Bucle que intenta inicializar y mantener la conexión con MT5."""
    global MT5_INITIALIZED
    while True:
        if not MT5_INITIALIZED:
            logger.info("MT5: Intentando conectar con la terminal MetaTrader 5...")
            # Inicializa MT5. Intenta conectarse a la terminal abierta por defecto.
            if mt5.initialize():
                logger.info("MT5: Conexion exitosa con MetaTrader 5!")
                # Mostrar versión de MT5
                version = mt5.version()
                logger.info(f"MT5: Version de MT5: {version}")
                
                # Intentar habilitar EURUSD y GBPUSD en MarketWatch
                for sym in ["EURUSD", "GBPUSD"]:
                    selected = mt5.symbol_select(sym, True)
                    if not selected:
                        logger.warning(f"MT5: No se pudo seleccionar/activar el simbolo {sym} en MarketWatch")
                    else:
                        logger.info(f"MT5: Simbolo {sym} activo en MarketWatch.")
                
                MT5_INITIALIZED = True
            else:
                logger.error(f"MT5: Error al inicializar MT5: {mt5.last_error()}. Asegurate de que la terminal de escritorio de MT5 este abierta.")
                MT5_INITIALIZED = False
        else:
            # Verificar si sigue conectado
            terminal_info = mt5.terminal_info()
            if terminal_info is None:
                logger.warning("MT5: Se perdio la conexion con la terminal de MT5.")
                MT5_INITIALIZED = False
                mt5.shutdown()
        await asyncio.sleep(5)

def get_account_data():
    """Obtiene y formatea los datos de la cuenta en MT5."""
    if not MT5_INITIALIZED:
        return None
    
    acc_info = mt5.account_info()
    if acc_info is None:
        return None
    
    return {
        "type": "account",
        "balance": acc_info.balance,
        "equity": acc_info.equity,
        "profit": acc_info.profit,
        "margin": acc_info.margin,
        "margin_free": acc_info.margin_free,
        "leverage": acc_info.leverage,
        "currency": acc_info.currency,
        "server": acc_info.server,
        "login": acc_info.login,
        "status": "connected"
    }

async def broadcast(message_dict):
    """Envía un mensaje JSON a todos los clientes conectados."""
    if not CONNECTED_CLIENTS:
        return
    
    message_str = json.dumps(message_dict)
    inactive_clients = set()
    
    for client in CONNECTED_CLIENTS:
        try:
            await client.send(message_str)
        except websockets.exceptions.ConnectionClosed:
            inactive_clients.add(client)
        except Exception as e:
            logger.error(f"Error al enviar mensaje a cliente: {e}")
            inactive_clients.add(client)
            
    if inactive_clients:
        CONNECTED_CLIENTS.difference_update(inactive_clients)

async def tick_broadcaster():
    """Bucle de alta frecuencia para consultar y transmitir ticks de EURUSD y GBPUSD."""
    global MT5_INITIALIZED
    while True:
        if MT5_INITIALIZED:
            for symbol in ["EURUSD", "GBPUSD"]:
                tick = mt5.symbol_info_tick(symbol)
                if tick is not None:
                    bid = tick.bid
                    ask = tick.ask
                    
                    # Solo transmitir si el precio cambió
                    if bid != last_ticks[symbol]["bid"] or ask != last_ticks[symbol]["ask"]:
                        last_ticks[symbol]["bid"] = bid
                        last_ticks[symbol]["ask"] = ask
                        
                        await broadcast({
                            "type": "tick",
                            "symbol": symbol,
                            "bid": bid,
                            "ask": ask,
                            "time": tick.time
                        })
                else:
                    logger.debug(f"No se pudo obtener el tick para {symbol}")
        await asyncio.sleep(0.1) # 100ms interval (frecuencia de 10Hz)

async def account_broadcaster():
    """Bucle para transmitir métricas de cuenta periódicamente (cada 1s)."""
    while True:
        if MT5_INITIALIZED:
            data = get_account_data()
            if data:
                await broadcast(data)
        await asyncio.sleep(1.0)

async def handler(websocket):
    """Manejador de conexiones WebSocket entrantes."""
    logger.info(f"WS: Nuevo cliente conectado desde {websocket.remote_address}")
    CONNECTED_CLIENTS.add(websocket)
    
    # Enviar estado inicial
    if MT5_INITIALIZED:
        acc_data = get_account_data()
        if acc_data:
            await websocket.send(json.dumps(acc_data))
        
        # Enviar últimos ticks conocidos
        for symbol in ["EURUSD", "GBPUSD"]:
            if last_ticks[symbol]["bid"] > 0:
                await websocket.send(json.dumps({
                    "type": "tick",
                    "symbol": symbol,
                    "bid": last_ticks[symbol]["bid"],
                    "ask": last_ticks[symbol]["ask"],
                    "time": 0
                }))
    else:
        # Enviar estado de desconectado del broker
        await websocket.send(json.dumps({
            "type": "account",
            "status": "disconnected",
            "balance": 0,
            "equity": 0
        }))

    try:
        async for message in websocket:
            # Procesar posibles comandos enviados por el cliente web
            try:
                data = json.loads(message)
                logger.info(f"WS: Mensaje recibido del cliente: {data}")
                
                # Espacio reservado para lógica de órdenes futuras
                # Por ejemplo: {"action": "buy", "symbol": "EURUSD", "volume": 0.1}
                if data.get("action") == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                logger.warning(f"WS: Mensaje no decodificable recibido: {message}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        logger.info(f"WS: Cliente desconectado {websocket.remote_address}")
        CONNECTED_CLIENTS.remove(websocket)

async def main():
    # Iniciar tareas concurrentes
    asyncio.create_task(check_mt5_connection())
    asyncio.create_task(tick_broadcaster())
    asyncio.create_task(account_broadcaster())
    
    logger.info("WS: Levantando servidor WebSocket local en ws://127.0.0.1:8000 ...")
    async with websockets.serve(handler, "127.0.0.1", 8000):
        await asyncio.Future()  # Correr infinitamente

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("MT5: Servidor detenido por el usuario.")
        if MT5_INITIALIZED:
            mt5.shutdown()
