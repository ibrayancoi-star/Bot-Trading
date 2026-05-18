import asyncio
import json
import logging
import sys
import MetaTrader5 as mt5
import websockets
import subprocess

# Configuración de Logs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("MT5Bridge")

# Mapa de temporalidades para MetaTrader 5
# IMPORTANTE: Las claves DEBEN coincidir exactamente con el tipo Timeframe del frontend (minúsculas)
TIMEFRAME_MAP = {
    "1m": mt5.TIMEFRAME_M1,
    "3m": mt5.TIMEFRAME_M3,
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "30m": mt5.TIMEFRAME_M30,
    "1h": mt5.TIMEFRAME_H1,
    "2h": mt5.TIMEFRAME_H2,
    "4h": mt5.TIMEFRAME_H4,
    "6h": mt5.TIMEFRAME_H6,
    "8h": mt5.TIMEFRAME_H8,
    "12h": mt5.TIMEFRAME_H12,
    "1d": mt5.TIMEFRAME_D1,
    "1w": mt5.TIMEFRAME_W1,
    "1M": mt5.TIMEFRAME_MN1,
}

# Estado de Conexiones
CONNECTED_CLIENTS = set()
MT5_INITIALIZED = False

# Últimos ticks conocidos para evitar envíos redundantes
last_ticks = {
    "EURUSD": {"bid": 0.0, "ask": 0.0},
    "GBPUSD": {"bid": 0.0, "ask": 0.0}
}

def is_mt5_running():
    """Comprueba mediante tasklist si la terminal de MT5 se está ejecutando."""
    try:
        output = subprocess.check_output('tasklist', shell=True).decode('utf-8', errors='ignore')
        return 'terminal64.exe' in output.lower() or 'terminal.exe' in output.lower()
    except Exception:
        return False

async def check_mt5_connection():
    """Bucle que intenta inicializar y mantener la conexión con MT5, sin forzar su apertura."""
    global MT5_INITIALIZED
    while True:
        if not MT5_INITIALIZED:
            if not is_mt5_running():
                logger.debug("MT5: La terminal no esta abierta. Esperando a que el usuario la abra manualmente...")
                await asyncio.sleep(5)
                continue

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
    
    server_lower = acc_info.server.lower()
    trade_mode = acc_info.trade_mode
    
    # Palabras clave comunes de servidores de empresas de fondeo (Prop Firms)
    prop_keywords = [
        "ftmo", "funding", "funded", "prop", "ttp", "challenge", "evaluation", 
        "funder", "e8", "tff", "myforexfunds", "mff", "fundingpips", "smartprop"
    ]
    
    is_prop = any(kw in server_lower for kw in prop_keywords)
    
    if is_prop:
        account_type = "fondeo"
    elif trade_mode == 2:
        account_type = "real"
    else:
        account_type = "demo"
    
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
        "trade_mode": acc_info.trade_mode,
        "account_type": account_type,
        "status": "connected"
    }

async def positions_broadcaster():
    """Bucle que consulta y transmite las posiciones abiertas actuales."""
    global MT5_INITIALIZED
    while True:
        if MT5_INITIALIZED:
            try:
                positions = mt5.positions_get()
                if positions is not None:
                    pos_list = []
                    for p in positions:
                        pos_list.append({
                            "ticket": p.ticket,
                            "symbol": p.symbol,
                            "type": "buy" if p.type == mt5.ORDER_TYPE_BUY else "sell",
                            "volume": p.volume,
                            "open_price": p.price_open,
                            "sl": p.sl,
                            "tp": p.tp,
                            "profit": p.profit,
                            "time": p.time
                        })
                    await broadcast({
                        "type": "positions",
                        "data": pos_list
                    })
            except Exception as e:
                logger.error(f"MT5: Error en positions_broadcaster: {e}")
        await asyncio.sleep(1) # Refrescar posiciones cada segundo

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
                
                action = data.get("action")
                if action == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
                
                elif action == "request_history":
                    symbol = data.get("symbol", "EURUSD")
                    tf_str = data.get("timeframe", "1m")
                    
                    # Forzar EURUSD por ahora según requerimiento
                    if symbol != "EURUSD":
                        logger.warning(f"WS: Petición de historial para {symbol} forzada a EURUSD.")
                        symbol = "EURUSD"
                        
                    mt5_tf = TIMEFRAME_MAP.get(tf_str, mt5.TIMEFRAME_M1)
                    logger.info(f"WS: Solicitando historial de 300 velas para {symbol} ({tf_str})")
                    
                    if not MT5_INITIALIZED:
                        logger.warning("WS: Intento de copiar rates pero MT5 no está inicializado.")
                        await websocket.send(json.dumps({
                            "type": "history",
                            "symbol": symbol,
                            "timeframe": tf_str,
                            "data": []
                        }))
                        continue
                    
                    # Obtener las últimas 10000 velas para dar máximo historial posible en web
                    rates = mt5.copy_rates_from_pos(symbol, mt5_tf, 0, 10000)
                    
                    if rates is None or len(rates) == 0:
                        logger.error(f"MT5: Error al copiar rates: {mt5.last_error()}")
                        await websocket.send(json.dumps({
                            "type": "history",
                            "symbol": symbol,
                            "timeframe": tf_str,
                            "data": []
                        }))
                    else:
                        candle_list = []
                        for rate in rates:
                            candle_list.append({
                                "time": int(rate['time']), # UNIX timestamp en segundos
                                "open": float(rate['open']),
                                "high": float(rate['high']),
                                "low": float(rate['low']),
                                "close": float(rate['close']),
                                "volume": int(rate['tick_volume']),
                                "isFinal": True
                            })
                        
                        logger.info(f"MT5: Enviado historial exitosamente ({len(candle_list)} velas) para {symbol} ({tf_str})")
                        await websocket.send(json.dumps({
                            "type": "history",
                            "symbol": symbol,
                            "timeframe": tf_str,
                            "data": candle_list
                        }))
                
                elif action in ["buy", "sell"]:
                    symbol = data.get("symbol", "EURUSD")
                    volume = float(data.get("volume", 0.1))
                    sl = float(data.get("sl", 0.0))
                    tp = float(data.get("tp", 0.0))
                    
                    if not MT5_INITIALIZED:
                        logger.warning("WS: Intento de orden pero MT5 no está inicializado.")
                        continue
                        
                    order_type = mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL
                    price = mt5.symbol_info_tick(symbol).ask if action == "buy" else mt5.symbol_info_tick(symbol).bid
                    
                    request = {
                        "action": mt5.TRADE_ACTION_DEAL,
                        "symbol": symbol,
                        "volume": volume,
                        "type": order_type,
                        "price": price,
                        "deviation": 20,
                        "magic": 234000,
                        "comment": "Web UI Order",
                        "type_time": mt5.ORDER_TIME_GTC,
                        "type_filling": mt5.ORDER_FILLING_IOC,
                    }
                    
                    if sl > 0:
                        request["sl"] = sl
                    if tp > 0:
                        request["tp"] = tp
                        
                    # Intentar enviar orden con múltiples Filling Modes
                    filling_modes = [
                        mt5.ORDER_FILLING_IOC,
                        mt5.ORDER_FILLING_FOK,
                        mt5.ORDER_FILLING_RETURN
                    ]
                    
                    result = None
                    for mode in filling_modes:
                        request["type_filling"] = mode
                        result = mt5.order_send(request)
                        if result is not None and result.retcode == mt5.TRADE_RETCODE_DONE:
                            break
                        
                        retcode = result.retcode if result else "None"
                        logger.warning(f"MT5: Orden con mode {mode} rechazada ({retcode}), probando otro...")

                    if result is None:
                        logger.error(f"MT5: Error crítico al enviar orden. mt5.last_error(): {mt5.last_error()}")
                    elif result.retcode != mt5.TRADE_RETCODE_DONE:
                        logger.error(f"MT5: Error al enviar orden: {result.comment} ({result.retcode})")
                    else:
                        logger.info(f"MT5: Orden ejecutada exitosamente. Ticket: {result.order}")
                        
                elif action == "modify_position":
                    ticket = int(data.get("ticket"))
                    sl = float(data.get("sl", 0.0))
                    tp = float(data.get("tp", 0.0))
                    
                    request = {
                        "action": mt5.TRADE_ACTION_SLTP,
                        "position": ticket,
                        "sl": sl,
                        "tp": tp,
                    }
                    result = mt5.order_send(request)
                    if result.retcode != mt5.TRADE_RETCODE_DONE:
                        logger.error(f"MT5: Error al modificar SL/TP: {result.comment} ({result.retcode})")
                    else:
                        logger.info(f"MT5: SL/TP modificado para ticket {ticket}")

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
    asyncio.create_task(positions_broadcaster())
    
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
