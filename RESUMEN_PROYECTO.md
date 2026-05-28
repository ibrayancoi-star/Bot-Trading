# Documentación y Resumen del Proyecto: Dashboard de Trading Híbrido

## 💡 Idea Central del Desarrollo
El proyecto consiste en la creación de una plataforma de trading avanzada (tipo TradingView) orientada a ofrecer un entorno visual premium, analítica de mercado y ejecución de órdenes en un solo lugar, con un sistema de inteligencia artificial y contexto.

### Arquitectura Híbrida:
1. **Frontend (Panel de Monitoreo Visual - Next.js)**: Conserva la interfaz premium y el estado reactivo ya construidos. Se conecta a un servidor WebSocket local administrado por Python para pintar gráficos y métricas de la cuenta de forma reactiva y ultrarrápida.
2. **Backend/Motor de Ejecución (Python + MT5)**: Un script en segundo plano (`mt5_bridge.py`) que corre localmente, se conecta de manera nativa a la terminal de escritorio de MetaTrader 5 (MT5), extrae ticks en tiempo real, procesa la lógica de las estrategias, ejecuta el control de riesgo y envía las órdenes al broker.
3. **Módulo de Contexto e Inteligencia (ChromaDB + NLP)**: Un motor de contexto basado en la base de datos vectorial ChromaDB y Transformers que procesa un reglamento en lenguaje natural, filtra operativas por contexto semántico y se retroalimenta automáticamente de las operaciones fallidas.

---

## 🤖 Estado Actual del Bot (Auto Trading)

### Qué funciona:
- La integración base del motor, el encendido y apagado general (botón "INICIAR BOT" / "DETENER BOT" en el panel derecho).
- El soporte multi-símbolo (selección de activos EURUSD/GBPUSD).
- El escáner asíncrono y la detección de oportunidades en background.
- La evaluación de contexto vectorial (ChromaDB) y las capas de validación.
- **Interfaz de Configuración de Estrategias:** Un modal flotante independiente con estilo premium que permite modificar la estrategia, gestión de riesgo (TP, SL, pérdida diaria), configuración de ChromaDB, killzones y gestión de operaciones.
- **Resolución de Bucles de Eco y Conexión (HMR Safe):** Se corrigió la fuga de conexiones WebSocket y la duplicidad de suscriptores Zustand generadas por los refrescos en caliente (Ctrl + F5 y recarga del servidor de Python) y se implementó una cláusula de guarda estricta para evitar la oscilación y bucles infinitos de encendido/apagado.

### Qué no funciona:
- **Rechazo de Señales por ATR:** Actualmente, el bot en todo momento rechaza las señales detectadas escudándose en las condiciones de validación del ATR.

### Qué falta:
- **Flexibilidad Completa de Parámetros:** Ajustar el motor de reglas en el backend para que la totalidad de los parámetros enviados desde el frontend (incluyendo los de la metodología CRT) sean respetados, dando total flexibilidad al usuario y evitando rechazos estrictos indeseados.

---

## 🧠 Decisiones Tomadas y Por Qué

1. **Inclusión de Metodología CRT Institucional**
   - *Decisión:* Se extendió el modal de configuración y el bridge de Python para incorporar multiplicadores de riesgo (TBS/TWS) y confluencias avanzadas (Híbrida M1/M15, Divergencia SMT).
   - *Por qué:* El usuario necesita mayor control sobre la lógica del algoritmo. Añadir estos parámetros de forma visual permite jugar con la flexibilidad del bot y adaptar su agresividad sin tener que tocar el código fuente del motor en Python.

2. **Interfaz de Configuración como Modal Independiente**
   - *Decisión:* Se diseñó la configuración del bot como una ventana modal flotante arrastrable en lugar de un panel lateral.
   - *Por qué:* Maximiza el área del gráfico de precios y mantiene un aspecto premium (simulando software de escritorio) permitiendo cerrarlo sin alterar el layout principal.

3. **Estructura HMR-Safe y Persistencia de Estado de Conexión en `window`**
   - *Decisión:* Almacenar el socket activo, las flags de suscripción y persistir las variables clave de Zustand (`botConfig`, `isBotActive`, `botActiveSymbols`) en `localStorage`.
   - *Por qué:* En desarrollo (Next.js con hot-reloading), re-evaluar los módulos creaba múltiples conexiones huérfanas de WebSocket en segundo plano y registraba múltiples callbacks suscriptores que colisionaban entre sí. Al persistirlos y gestionarlos en el objeto global `window`, garantizamos una sola conexión activa y una única suscripción global que sincroniza de forma limpia el estado del bot.

---

## 🎯 Próximo Paso Exacto

1. **Poder Ajustar los Parámetros en su Totalidad / Lógica del ATR:** Revisar la lógica dura de validación en Python (`validate_hard_rules` y cálculos de ATR) para permitir jugar con la flexibilidad del bot. La idea es que los parámetros dictados por el usuario desde el modal reemplacen o flexibilicen las restricciones estrictas que causan el rechazo constante de operaciones.

---

## 📜 Resumen del Código Completo Más Reciente (LeftSidebar.tsx modal con CRT)

```tsx
"use client";

import { useState, useEffect } from "react";
import { useTradingStore, type BotConfig, type Strategy, type KillzoneName } from "@/lib/store/trading-store";
import { Button } from "@/components/ui/button";
import { Sparkles, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function LeftSidebar() {
  const isLeftSidebarOpen = useTradingStore((s) => s.isLeftSidebarOpen);
  const toggleLeftSidebar = useTradingStore((s) => s.toggleLeftSidebar);
  const botConfig = useTradingStore((s) => s.botConfig);
  const setBotConfig = useTradingStore((s) => s.setBotConfig);

  // Estados locales, ahora incluyendo reglas CRT
  const [strategy, setStrategy] = useState<Strategy>("scalping");
  // ... (estados previos de riesgo y Chroma omitidos por brevedad)
  const [modelTbsRiskMultiplier, setModelTbsRiskMultiplier] = useState<number>(1.0);
  const [modelTwsRiskMultiplier, setModelTwsRiskMultiplier] = useState<number>(0.5);
  const [hybridM1M15Confluence, setHybridM1M15Confluence] = useState<boolean>(true);
  const [smtDivergenceCheck, setSmtDivergenceCheck] = useState<boolean>(true);

  // Dragging states omitidos...

  useEffect(() => {
    if (botConfig) {
      // Sincronización de estados
      if (botConfig.modelTbsRiskMultiplier !== undefined) setModelTbsRiskMultiplier(botConfig.modelTbsRiskMultiplier);
      if (botConfig.modelTwsRiskMultiplier !== undefined) setModelTwsRiskMultiplier(botConfig.modelTwsRiskMultiplier);
      if (botConfig.hybridM1M15Confluence !== undefined) setHybridM1M15Confluence(botConfig.hybridM1M15Confluence);
      if (botConfig.smtDivergenceCheck !== undefined) setSmtDivergenceCheck(botConfig.smtDivergenceCheck);
    }
  }, [botConfig]);

  const handleApply = () => {
    const config: BotConfig = {
      strategy, /* ... otros configs ... */
      modelTbsRiskMultiplier,
      modelTwsRiskMultiplier,
      hybridM1M15Confluence,
      smtDivergenceCheck,
    };
    setBotConfig(config);
    toggleLeftSidebar();
  };

  if (!isLeftSidebarOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-96 max-h-[85vh] flex-col border border-zinc-800 bg-zinc-950 rounded-xl shadow-2xl overflow-y-auto">
        {/* Cabecera y secciones anteriores omitidas */}
        
        {/* Sección 6: Metodología CRT Institucional */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tv-text-muted uppercase">
            <Sparkles className="h-3.5 w-3.5 text-tv-blue animate-pulse" />
            <span>⚡ METODOLOGÍA CRT INSTITUCIONAL</span>
          </div>

          <div className="flex justify-between items-center bg-tv-bg border border-zinc-800 rounded-md px-3 py-1.5">
            <div className="flex items-center">
              <span className="text-[11px] text-tv-text-muted">Multiplicador TBS</span>
              <span className="text-tv-blue text-[10px] ml-2">(Activo: {botConfig?.modelTbsRiskMultiplier ?? 1.0})</span>
            </div>
            <input
              type="number" step="0.1"
              value={modelTbsRiskMultiplier}
              onChange={(e) => setModelTbsRiskMultiplier(parseFloat(e.target.value) || 1.0)}
              className="bg-transparent text-right text-xs font-mono text-tv-text outline-none w-16"
            />
          </div>
          {/* ... Inputs de TWS, Híbrida y SMT ... */}
        </div>

        {/* Botón de Aplicar */}
        <div className="p-4 mt-auto border-t border-zinc-800 bg-zinc-900/30">
          <Button onClick={handleApply}>APLICAR CONFIGURACIÓN</Button>
        </div>
      </div>
    </div>
  );
}
```

---

## 🏗️ Implementaciones Realizadas (Histórico)
* Frontend Reactivo Next.js + Tailwind.
* Puente asíncrono con MetaTrader 5 y WebSocket (`mt5_bridge.py`).
* Integración ChromaDB y modelos NLP.
* Motor de gráficos asíncronos Lightweight Charts.
* Escáner Autónomo y Risk Guard System.
