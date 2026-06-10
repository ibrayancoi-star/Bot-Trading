Este informe técnico detalla la ejecución optimizada de la **Metodología CRT (Candle Range Theory)**, integrando la microestructura de liquidez con algoritmos de tiempo institucional.

### 1\. Ejecución Técnica: TBS, TWS y Modelos Híbridos

La manipulación de liquidez en los extremos del rango se clasifica según la interacción del precio con el **CRT High** o **CRT Low** en la temporalidad de entrada (LTF).

* **Turtle Body Soup (TBS):** Ocurre cuando el cuerpo de una vela LTF (M5/M1) cierra completamente **fuera** del límite del rango HTF, pero la vela siguiente revierte con fuerza y cierra dentro 1, 2\. Es el **Modelo A+** (alta probabilidad) porque atrapa volumen real de ruptura antes de la reversión 1, 3\.  
* **Turtle Wick Soup (TWS):** Únicamente la mecha penetra el nivel de liquidez, manteniendo el cierre siempre dentro del rango 1, 4\. Se considera de **probabilidad moderada** y es más propenso a barridos secundarios 1, 5\.  
* **Modelo Híbrido (TBS \+ TWS):** La optimización máxima ocurre cuando el bot o el operador identifica un **TBS en M1** anidado dentro de un rechazo de **mecha (TWS) en M15** 6, 7\. Esta confluencia confirma que la intención institucional ha absorbido toda la liquidez del extremo 8\.

### 2\. Determinación de Rangos y su Fractalidad

La CRT postula que el mercado es fractal; cada vela HTF es un rango AMD (Acumulación, Manipulación, Distribución) en LTF 9, 10\.

* **Rango de Referencia (Vela 1):** Se define por el máximo absoluto (**CRT High**) y el mínimo absoluto (**CRT Low**) de una vela ancla seleccionada por tiempo 11, 12\.  
* **Fractalidad y Anidación (Nested CRT):** Un patrón CRT en M5 formado dentro de la zona de liquidez de un rango H4 aumenta drásticamente el *win rate* 6, 13\. "Cuantas más *inside bars* contenga el rango antes de la liquidación, mayor es la probabilidad de expansión violenta" 6, 13, 14\.  
* **Dinámica de Cuartos:** El tiempo se divide en cuatro partes (Q1-Q4). En un rango clásico, Q1 es acumulación, Q2 es manipulación y Q3 es distribución 15, 16\.

### 3\. Aprovechamiento de Killzones y Algoritmos de Tiempo

El tiempo representa el **70% de la importancia** operativa 17, 18\. Los setups fuera de estas ventanas deben ignorarse por su baja probabilidad.

* **Velas de Anclaje Críticas:** Los ciclos institucionales se resetean en las velas de las **1:00 AM, 5:00 AM y 9:00 AM EST** 19-21.  
* **London Killzone (02:00 \- 05:00 EST):** Ideal para capturar el barrido del rango asiático (Asia Sweep) 22-24.  
* **NY Magic Hour (10:00 \- 11:00 AM EST):** La ventana de mayor probabilidad del día para distribuciones de largo alcance 25-27.  
* **The 9:30 Judas:** Entre las 9:00 y 9:30 AM ocurre la acumulación; de 9:30 a 10:00 AM la manipulación (Judas Swing) y a las 10:00 AM inicia la distribución real 28, 29\.

### 4\. Énfasis en Rangos LTF para Claridad

Para una ejecución quirúrgica, el operador debe mapear la microestructura en M5 o M1 tras la formación del rango HTF (H4 o H1).

* **Identificación en LTF:** El precio debe "limpiar" la liquidez externa (CRT High/Low) y mostrar un **CSD (Cambio en el Estado de Entrega)** 30, 31\.  
* **Validación de Mechas:** La vela de manipulación (Vela 2\) no debe tener un cuerpo que exceda el **20%** del tamaño total de la vela de impulso inicial 1, 32, 33\.  
* **Reclamo del Rango:** La entrada solo es válida si la **Vela 3 cierra obligatoriamente dentro** del rango de la Vela 1 34-36.

### 5\. Optimización Estratégica con Fuentes

Para maximizar la efectividad del sistema, se deben aplicar los siguientes filtros avanzados extraídos de los archivos técnicos:

* **Filtro SMT (Smart Money Technique):** Si el EURUSD barre su mínimo CRT pero el GBPUSD no lo hace, se confirma la intervención institucional (Divergencia SMT) 37, 38\.  
* **Filtro de Equilibrio (EQ):** El punto medio (50%) del rango CRT actúa como imán. Las compras solo se ejecutan en **Zona de Descuento** (por debajo del 50%) y las ventas en **Zona de Prima** (por encima del 50%) 39-41.  
* **Alineación con el Bias Diario:** El setup CRT debe ir a favor del *Draw on Liquidity* (DOL) del gráfico diario 42-44. "Si el HTF es alcista, vender un Turtle Soup en LTF resultará en pérdida" Documento anterior.  
* **News Shield:** Suspensión operativa 30 minutos antes y 60 minutos después de noticias de alto impacto (NFP, CPI, FOMC) 45, 46\.

### 6\. Paso a Paso para Ejecución Práctica

Este es el protocolo estándar de operación (**S.O.P.**):

* **Contexto Macro (20:00 \- 22:00 EST):** Determinar el *Daily Bias* analizando la estructura de D1 y el DXY 47, 48\.  
* **Identificación del Ancla (1, 5 o 9 AM EST):** Marcar el **CRT High** y **CRT Low** de la vela de referencia HTF seleccionada 19, 42, 44\.  
* **Espera del Barrido (Killzone):** Monitorear el precio en LTF (M5/M1) hasta que cruce uno de los extremos del rango durante una ventana operativa 35, 42\.  
* **Confirmación de Manipulación:** Verificar si es un **TBS** o **TWS**. El cuerpo de la vela trampa debe ser pequeño (\<20%) 1, 32\. Validar con **Divergencia SMT** 38, 49\.  
* **Gatillo de Entrada:** Entrar al mercado inmediatamente cuando la **Vela 3 cierre de vuelta dentro** del rango CRT 50-52.  
* **Gestión de Riesgo:**  
* **Stop Loss:** Detrás del mínimo/máximo de la mecha de manipulación (+ 1.5 pips de buffer) 42, 53, 54\.  
* **TP1 (Equilibrio):** Al alcanzar el 50% del rango, cerrar el 50% de la posición y mover a *Breakeven* 53, 55, 56\.  
* **TP2 (Extremo):** Al alcanzar el 100% del rango opuesto 53, 57, 58\.

