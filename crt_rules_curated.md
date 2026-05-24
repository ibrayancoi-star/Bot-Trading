# [CRT_BOT_RULES] - Manual de Especificaciones Técnicas

## 1. CAPA 1: REGLAS DETERMINISTAS (HARD RULES) - Fórmulas de cálculo
Fórmulas de cálculo del Rango HTF:
CRT High: Valor del máximo absoluto (High) de la vela de referencia seleccionada por tiempo.
CRT Low: Valor del mínimo absoluto (Low) de la vela de referencia.
Midpoint / Equilibrium (EQ): CRT_Low+0.5×(CRT_High−CRT_Low).

## 1. CAPA 1: REGLAS DETERMINISTAS (HARD RULES) - Restricciones de Tiempo
Restricciones de Tiempo (Horario EST - New York):
Velas de Anclaje (Anchor Candles): El sistema debe identificar rangos en las velas que cierran a las 01:00 AM, 05:00 AM y 09:00 AM EST.
Killzones Operativas: London Open (02:00-05:00 AM), NY Open (07:00-10:00 AM), NY PM (13:00-16:00).
TMT Magic Hour: Ventana de máxima probabilidad entre las 10:00 AM y 11:00 AM EST.

## 1. CAPA 1: REGLAS DETERMINISTAS (HARD RULES) - Restricciones de Dimensión
Restricciones de Dimensión:
Amplitud Mínima: El rango de la vela debe ser > 0.08% en Forex o > 20 puntos en índices.
Filtro ATR: El cuerpo de la vela de referencia debe representar al menos el 10% del ATR de 14 periodos.

## 1. CAPA 1: REGLAS DETERMINISTAS (HARD RULES) - Umbral de Spread
Umbral de Spread:
Máximo: La ejecución se cancela si el spread supera el 20% del ATR de la temporalidad de entrada (LTF).

## 1. CAPA 1: REGLAS DETERMINISTAS (HARD RULES) - Evidencia Visual y Video
[EVIDENCIA_VISUAL] En las fuentes gráficas se observa que los rangos ganadores son aquellos que utilizan el Monday Range (máximo y mínimo del lunes) o el Asian Range como anclas deterministas para barridos durante la semana. Un patrón visual clave de éxito es la formación de un "cuadro de patrón" donde la vela 3 envuelve a la vela 2 (trampa).
[EVIDENCIA_VIDEO] Las instrucciones de video confirman que el tiempo es el 70% de la importancia. Se especifica el ciclo 9:00-9:30 AM (acumulación), 9:30-10:00 AM (manipulación/Judas Swing) y 10:00-10:30 AM (distribución) como una regla de tiempo dura para el modelo de las 9 AM.

## 2. CAPA 2: REGLAS CONTEXTUALES (SOFT RULES) - Validación de Barrido
Validación de Barrido (Sweep):
TBS (Turtle Body Soup): El cuerpo de la vela LTF cierra fuera del rango HTF, pero la vela siguiente revierte y cierra dentro. Es el Modelo A+.
TWS (Turtle Wick Soup): Solo la mecha penetra el nivel. Para ser válido, la mecha de rechazo debe ser ≥50% del rango total de esa vela.
MaxTrapBodyRatio: El cuerpo de la vela de manipulación no debe exceder el 20% de la vela de impulso.

## 2. CAPA 2: REGLAS CONTEXTUALES (SOFT RULES) - Comportamiento en Midpoint
Comportamiento en el Midpoint (EQ):
El bot debe realizar un cierre parcial del 50% y mover el Stop Loss a Breakeven inmediatamente al tocar el EQ.
Si el precio cierra con cuerpo más allá del EQ tras el barrido sin haber mitigado el extremo opuesto, el setup pierde probabilidad.

## 2. CAPA 2: REGLAS CONTEXTUALES (SOFT RULES) - Sesgo de Temporalidad
Sesgo de Temporalidad (Orderflow):
Jerarquía: La dirección de la temporalidad mayor (HTF) es absoluta. Si el Daily Bias es alcista, se ignoran todos los CRTs bajistas en LTF.
Periodo de Gracia: Los barridos de alta probabilidad suelen ocurrir en los primeros 15 o últimos 15 minutos de una vela horaria.

## 2. CAPA 2: REGLAS CONTEXTUALES (SOFT RULES) - Evidencia Visual y Video
[EVIDENCIA_VISUAL] Los gráficos de "Nested CRT" demuestran que un trade ganador ocurre cuando un barrido en M15 se produce exactamente dentro de una zona de liquidez de H4 (doble confluencia). Visualmente, un trade perdedor se identifica cuando la vela de barrido (Vela 2) es una vela de "rango extendido" que cierra muy lejos del rango original, indicando una ruptura real y no una trampa.
[EVIDENCIA_VIDEO] En "videoplayback ts 3.mp4", se instruye que si la Vela 3 falla en comenzar la distribución y purga (vuelve a barrer) el mínimo de la Vela 2, el setup se invalida por completo. Además, se añade la restricción de que un setup es válido solo hasta que alcanza un key level HTF, momento en el cual el bias LTF debe resetearse.

## 3. CAPA 3: CONDICIONES DE EXCLUSIÓN CRÍTICA - Comportamiento de Velas
Comportamiento de Velas Prohibido:
Unbalanced Candles: Velas de rango extendido con cuerpos grandes cerca de los límites CRT que sugieren intención de continuación.
Mitigación: Una zona CRT se invalida tras el primer contacto exitoso que alcance el objetivo. No se operan segundos barridos.

## 3. CAPA 3: CONDICIONES DE EXCLUSIÓN CRÍTICA - Restricciones de Volatilidad
Restricciones de Volatilidad:
News Shield: Suspensión operativa 30 minutos antes y 60 minutos después de noticias de "carpeta roja" (NFP, CPI, FOMC).

## 3. CAPA 3: CONDICIONES DE EXCLUSIÓN CRÍTICA - Patrones de Setups Fallidos
Patrones de Setups Fallidos:
Sin Retorno: Si el precio barre el nivel pero no logra cerrar de vuelta dentro del rango en la Vela 3 (Ruptura Legítima).
SMT Failure: Si un par correlacionado (ej. EURUSD) barre su nivel pero el otro (ej. GBPUSD) no lo hace, el bot debe evitar el par que sí logró romper el nivel si busca una reversión.

## 3. CAPA 3: CONDICIONES DE EXCLUSIÓN CRÍTICA - Evidencia Visual y Video
[EVIDENCIA_VISUAL] Se evidencia visualmente setups perdedores en gráficos de "Failed reactions" donde el precio muestra incapacidad de hacer nuevos máximos tras un sweep, señalando que el Order Block será invalidado. Las imágenes muestran que operar en el "medio de la nada" (fuera de PD Arrays) resulta en trades fallidos.
[EVIDENCIA_VIDEO] Las instrucciones de video imponen una restricción absoluta: "Si el HTF es alcista, serás destrozado intentando vender un turtle soup en LTF". Esto obliga al bot a desactivar el módulo de ventas si el bias diario no es bajista, sin excepciones por la apariencia del patrón técnico local. También se prohíbe operar si el precio está en un "extreme premium" (muy por encima del precio de apertura de las 8:30 AM) para compras, incluso si hay un setup CRT.