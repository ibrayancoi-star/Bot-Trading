# Plan de Mejoras — Auditoría de Parámetros

**Generado:** 2026-06-15 | **Estado:** AUDITORÍA INICIAL

> Auditoría de rastreo completo de cada control de la UI de configuración del bot
> (`LeftSidebar.tsx`) hasta su consumo real en el motor Python. Cada afirmación de
> "se usa" / "no se usa" está citada con `archivo:línea`.
>
> **Cadena rastreada:** `LeftSidebar.tsx` (control UI) → `trading-store.ts` (tipo `BotConfig`)
> → `mock-feed.ts::sendBotConfig` (envío WS) → `mt5_bridge.py` (handler `BOT_CONFIG_UPDATE`,
> L1721-1768) → función del scanner/lógica que lo consume.

---

## 🚨 Hallazgo crítico (leer primero)

**Los 5 flags de la sección "Metodología CRT Institucional" NUNCA llegan al bridge** por un
desajuste de nomenclatura en el mapeo:

- `sendBotConfig()` ([mock-feed.ts:305-310](src/lib/data/mock-feed.ts)) envía el objeto `BotConfig`
  **tal cual**, con claves **camelCase** de TypeScript (`requireCandleConfirmation`, `useDynamicSl`, …).
- El handler del bridge lee esos 5 campos en **snake_case** ([mt5_bridge.py:1742-1746](mt5_bridge.py)):
  `payload.get("require_candle_confirmation", …)`, `payload.get("use_dynamic_sl", …)`, etc.
- `payload.get("require_candle_confirmation")` sobre un payload que solo tiene
  `requireCandleConfirmation` → devuelve `None` → cae al **default `False`** y **nunca cambia**.

**Efecto en cascada:** `requireCandleConfirmation` es el flag que activa la clasificación
TBS/TWS ([mt5_bridge.py:823](mt5_bridge.py), [L881](mt5_bridge.py)). Como nunca se activa,
`sweep_type` siempre es `None` ([mt5_bridge.py:850](mt5_bridge.py)), lo que a su vez desactiva:
- Multiplicadores TBS/TWS ([mt5_bridge.py:1017](mt5_bridge.py) — `if sweep_type and …`).
- SL dinámico ([mt5_bridge.py:998](mt5_bridge.py) — requiere `sweep_vela_2`, que solo se setea bajo confirmación).

> **En la práctica, toda la "Metodología CRT Institucional v2" (TBS/TWS, SL dinámico,
> objetivos CRT, cierre parcial en EQ, divergencia SMT) está inerte desde la UI.** El bot
> opera con sweep de 1 tick y SL/TP fijos, sin importar cómo configure el usuario esa sección.

Contraste: los campos del MISMO modal que sí usan camelCase en el `payload.get` (ej.
`modelTbsRiskMultiplier` en [mt5_bridge.py:1736](mt5_bridge.py)) sí llegan correctamente —
confirma que el bug está aislado en esos 5 `payload.get` en snake_case.

---

## 1. Tabla Maestra de Parámetros

Leyenda: ✅ ACTIVO · 🔶 CONDICIONAL · ❌ DECORATIVO · ⚠️ HUÉRFANO (roto en el mapeo)

| Parámetro UI | Campo Store (TS) | Campo Bridge (`payload.get`) | Usado en (archivo:línea) | Estado |
|---|---|---|---|---|
| Estrategia Activa | `strategy` | `"strategy"` ✓ | solo se asigna y loguea ([mt5_bridge.py:1724](mt5_bridge.py), [L1768](mt5_bridge.py)); el scanner usa lógica inline, `IStrategy` no conectada | ❌ DECORATIVO |
| Lotaje Base | `lotSize` | `"lotSize"` ✓ | [mt5_bridge.py:957](mt5_bridge.py) → `volume` [L1014](mt5_bridge.py) | ✅ ACTIVO |
| Take Profit (Pips) | `takeProfitPips` | `"takeProfitPips"` ✓ | [mt5_bridge.py:958](mt5_bridge.py) → cálculo TP [L994](mt5_bridge.py) | ✅ ACTIVO |
| Stop Loss (Pips) | `stopLossPips` | `"stopLossPips"` ✓ | [mt5_bridge.py:959](mt5_bridge.py) → cálculo SL | ✅ ACTIVO |
| Posiciones Máximas | `maxPositions` | `"maxPositions"` ✓ | [mt5_bridge.py:779-782](mt5_bridge.py) (bloquea scanner) | ✅ ACTIVO ⚠️ |
| Pérdida Diaria Máx (%) | `maxDailyLoss` | `"maxDailyLoss"` ✓ | [mt5_bridge.py:1340-1347](mt5_bridge.py) (Risk Guard) | ✅ ACTIVO |
| Umbral Similitud Chroma | `chromaThreshold` | `"chromaThreshold"` ✓ | [mt5_bridge.py:960](mt5_bridge.py), [L1846](mt5_bridge.py) | ✅ ACTIVO (informativo) |
| Top-K Similitudes | `chromaTopK` | `"chromaTopK"` ✓ | [mt5_bridge.py:961](mt5_bridge.py), [L1847](mt5_bridge.py) | ✅ ACTIVO (informativo) |
| Killzones (4 toggles) | `killzones` | `"killzones"` ✓ | [mt5_bridge.py:350-356](mt5_bridge.py) (validate_hard_rules), [L700-707](mt5_bridge.py) (pre-filtro) | ✅ ACTIVO ⚠️ |
| Trailing Stop | `trailingStop` | `"trailingStop"` ✓ | solo se asigna ([mt5_bridge.py:1733](mt5_bridge.py)); sin consumidor | ❌ DECORATIVO |
| Cierre Parcial | `partialClose` | `"partialClose"` ✓ | solo se asigna ([mt5_bridge.py:1734](mt5_bridge.py)); el cierre real usa `partial_close_at_eq` | ❌ DECORATIVO |
| Volumen Parcial (%) | `partialClosePct` | `"partialClosePct"` ✓ | [mt5_bridge.py:1186](mt5_bridge.py), pero dentro del bloque `partial_close_at_eq` (L1176) | 🔶 CONDICIONAL |
| Multiplicador TBS | `modelTbsRiskMultiplier` | `"modelTbsRiskMultiplier"` ✓ | [mt5_bridge.py:1018](mt5_bridge.py), solo si `sweep_type` (L1017) | 🔶 CONDICIONAL |
| Multiplicador TWS | `modelTwsRiskMultiplier` | `"modelTwsRiskMultiplier"` ✓ | [mt5_bridge.py:1018](mt5_bridge.py), solo si `sweep_type` (L1017) | 🔶 CONDICIONAL |
| Confluencia Híbrida M1/M15 | `hybridM1M15Confluence` | `"hybridM1M15Confluence"` ✓ | solo se asigna ([mt5_bridge.py:1738](mt5_bridge.py)); sin consumidor | ❌ DECORATIVO |
| Filtro Divergencia SMT (campo viejo) | `smtDivergenceCheck` | `"smtDivergenceCheck"` ✓ | solo se asigna ([mt5_bridge.py:1739](mt5_bridge.py)); el filtro real usa `smt_divergence_enabled` | ❌ DECORATIVO |
| Filtro Divergencia SMT (campo real) | `smtDivergenceEnabled` | `"smt_divergence_enabled"` ✗ | consumido en [mt5_bridge.py:932](mt5_bridge.py) pero **nunca llega** (mapeo roto) | ⚠️ HUÉRFANO |
| Confirmación por Vela (TBS/TWS) | `requireCandleConfirmation` | `"require_candle_confirmation"` ✗ | gatea [mt5_bridge.py:823](mt5_bridge.py), [L881](mt5_bridge.py); **nunca llega** | ⚠️ HUÉRFANO |
| Usar SL Dinámico (Vela 2) | `useDynamicSl` | `"use_dynamic_sl"` ✗ | consumido [mt5_bridge.py:998](mt5_bridge.py); **nunca llega** | ⚠️ HUÉRFANO |
| Usar Objetivos CRT (EQ/Extremo) | `useCrtTargets` | `"use_crt_targets"` ✗ | consumido [mt5_bridge.py:1008](mt5_bridge.py); **nunca llega** | ⚠️ HUÉRFANO |
| Cierre Parcial en EQ | `partialCloseAtEq` | `"partial_close_at_eq"` ✗ | consumido [mt5_bridge.py:1176](mt5_bridge.py); **nunca llega** | ⚠️ HUÉRFANO |
| Horario Londres (inicio/fin) | `londonStart` / `londonEnd` | `"londonStart"` / `"londonEnd"` ✓ | [mt5_bridge.py:352](mt5_bridge.py), [L685-686](mt5_bridge.py), [L701](mt5_bridge.py), [L730](mt5_bridge.py) | ✅ ACTIVO |
| Horario Nueva York (inicio/fin) | `newYorkStart` / `newYorkEnd` | `"newYorkStart"` / `"newYorkEnd"` ✓ | [mt5_bridge.py:354](mt5_bridge.py), [L687-688](mt5_bridge.py), [L703](mt5_bridge.py), [L731](mt5_bridge.py) | ✅ ACTIVO |
| Horario Asiática (inicio/fin) | `asianStart` / `asianEnd` | `"asianStart"` / `"asianEnd"` ✓ | [mt5_bridge.py:356](mt5_bridge.py), [L689-690](mt5_bridge.py), [L705](mt5_bridge.py), [L732](mt5_bridge.py) | ✅ ACTIVO |
| Spread máximo (pts) | `maxSpreadPoints` | `"maxSpreadPoints"` ✓ | [mt5_bridge.py:382](mt5_bridge.py) | ✅ ACTIVO |
| Desactivar filtro de spread | `disableSpreadFilter` | `"disableSpreadFilter"` ✓ | [mt5_bridge.py:381](mt5_bridge.py) | ✅ ACTIVO |
| ATR mínimo (pips) | `minAtrPips` | `"minAtrPips"` ✓ | [mt5_bridge.py:404](mt5_bridge.py) | ✅ ACTIVO |
| Desactivar filtro de ATR | `disableAtrFilter` | `"disableAtrFilter"` ✓ | [mt5_bridge.py:403](mt5_bridge.py) | ✅ ACTIVO |
| Ratio cuerpo/mecha máx (%) | `maxWickBodyRatio` | `"maxWickBodyRatio"` ✓ | [mt5_bridge.py:418](mt5_bridge.py) | ✅ ACTIVO |
| Desactivar filtro de mecha | `disableWickBodyFilter` | `"disableWickBodyFilter"` ✓ | [mt5_bridge.py:417](mt5_bridge.py) | ✅ ACTIVO |
| Desactivar filtro de dimensión | `disableDimensionFilter` | `"disableDimensionFilter"` ✓ | [mt5_bridge.py:442](mt5_bridge.py) | ✅ ACTIVO |
| Amplitud mínima Forex (%) | `minAmplitudeForexPct` | `"minAmplitudeForexPct"` ✓ | [mt5_bridge.py:443](mt5_bridge.py) | ✅ ACTIVO |
| Amplitud mínima Índices (pts) | `minAmplitudeIndicesPoints` | `"minAmplitudeIndicesPoints"` ✓ | [mt5_bridge.py:444](mt5_bridge.py) | ✅ ACTIVO |

**Conteo:** ✅ 23 ACTIVOS · 🔶 3 CONDICIONALES · ❌ 5 DECORATIVOS · ⚠️ 5 HUÉRFANOS · **Total 36**

---

## 2. Parámetros DECORATIVOS y HUÉRFANOS (acción requerida)

### ⚠️ HUÉRFANO-1 a HUÉRFANO-5 — Los 5 flags CRT (mapeo roto)

- **UI:** Sección "⚡ METODOLOGÍA CRT INSTITUCIONAL", [LeftSidebar.tsx:614-740](src/components/layout/LeftSidebar.tsx).
  Controles: *Confirmación por Vela (TBS/TWS)*, *Usar SL Dinámico*, *Usar Objetivos CRT*,
  *Cierre Parcial en EQ*, *Filtro Divergencia SMT*.
- **Qué promete:** Activar la metodología institucional completa (clasificación de barridos,
  SL detrás de la mecha, TP en EQ/extremo, cierre parcial + breakeven, filtro de divergencia).
  Incluso muestran un badge "(Activo: SÍ/NO)" que lee `botConfig` y refuerza la ilusión de que funciona.
- **Por qué no funciona:** El bridge lee estos 5 campos en snake_case
  ([mt5_bridge.py:1742-1746](mt5_bridge.py)) pero la UI los envía en camelCase
  ([mock-feed.ts:305-310](src/lib/data/mock-feed.ts) reenvía `BotConfig` sin transformar).
  El `payload.get()` no encuentra la clave y conserva el default `False`.
- **Recomendación:** **IMPLEMENTAR (fix de 1 línea × 5).** Cambiar las 5 claves del
  `payload.get` a camelCase para que coincidan con el resto del handler:
  `"require_candle_confirmation"` → `"requireCandleConfirmation"`, etc. Es el cambio de mayor
  impacto/menor esfuerzo de todo el proyecto: reactiva una metodología ya implementada y testeada.
- **Riesgo de dejarlo:** 🔴 **ALTO.** Da una falsa sensación de control sobre decisiones de
  dinero real: el usuario cree operar con TBS/TWS + SL dinámico y en realidad el bot opera con
  sweep de 1 tick y SL/TP fijos. Además invalida cualquier conclusión de backtesting/forward
  testing donde el usuario creyó tener la metodología activa.

> ⚠️ **Verificar tras el fix:** activar estos flags cambia el comportamiento de ejecución real.
> Probar primero en DEMO/BACKTEST con `verify_crt_behavior.py` / `audit_crt.py` antes de LIVE.

### ❌ DECORATIVO-1 — Estrategia Activa

- **UI:** [LeftSidebar.tsx:391-400](src/components/layout/LeftSidebar.tsx) (select scalping/swing/breakout/reversal).
- **Qué promete:** Cambiar el estilo de trading / temporalidad del bot.
- **Por qué no funciona:** `bot_config.strategy` solo se asigna y se loguea
  ([mt5_bridge.py:1724](mt5_bridge.py), [L1768](mt5_bridge.py)). El scanner usa lógica CRT inline;
  el `STRATEGY_REGISTRY` / `IStrategy` existe pero no está conectado (ver RESUMEN_PROYECTO.md).
- **Recomendación:** **QUITAR DE UI** (o marcar "próximamente") hasta que se conecte `IStrategy`.
  Hoy el selector sugiere 4 estrategias cuando solo existe CRT.
- **Riesgo de dejarlo:** 🟠 Medio. El usuario puede creer que opera "Swing" cuando siempre es CRT.

### ❌ DECORATIVO-2 — Trailing Stop

- **UI:** [LeftSidebar.tsx:568-579](src/components/layout/LeftSidebar.tsx).
- **Qué promete:** Mover el SL automáticamente conforme el precio avanza a favor.
- **Por qué no funciona:** `trailing_stop` solo se asigna ([mt5_bridge.py:1733](mt5_bridge.py));
  no hay ningún consumidor en el scanner ni en `positions_broadcaster`.
- **Recomendación:** **IMPLEMENTAR o QUITAR.** Si es prioridad de gestión, implementar en
  `positions_broadcaster`; si no, ocultar el toggle.
- **Riesgo de dejarlo:** 🟠 Medio. Promete protección de ganancias que no ocurre.

### ❌ DECORATIVO-3 — Cierre Parcial (toggle viejo)

- **UI:** [LeftSidebar.tsx:581-609](src/components/layout/LeftSidebar.tsx) (toggle + input % condicional).
- **Qué promete:** Cerrar parte de la posición en EQ y asegurar breakeven.
- **Por qué no funciona:** `partial_close` (campo viejo) solo se asigna
  ([mt5_bridge.py:1734](mt5_bridge.py)). El cierre parcial REAL existe pero se gatea con
  `partial_close_at_eq` ([mt5_bridge.py:1176](mt5_bridge.py)), que es HUÉRFANO. Hay **dos toggles
  distintos** para la misma función: este (viejo, decorativo) y "Cierre Parcial en EQ" (nuevo, huérfano).
- **Recomendación:** **UNIFICAR.** Eliminar el toggle viejo `partialClose` y dejar solo
  "Cierre Parcial en EQ" (`partialCloseAtEq`) una vez arreglado el mapeo. `partialClosePct` debe
  colgar del toggle unificado.
- **Riesgo de dejarlo:** 🟠 Medio + confusión: dos controles que parecen hacer lo mismo, ninguno funciona.

### ❌ DECORATIVO-4 — Confluencia Híbrida M1/M15

- **UI:** [LeftSidebar.tsx:653-665](src/components/layout/LeftSidebar.tsx).
- **Qué promete:** Exigir que el barrido M1 coincida con zona de liquidez M15.
- **Por qué no funciona:** `hybrid_m1_m15_confluence` solo se asigna
  ([mt5_bridge.py:1738](mt5_bridge.py)); sin consumidor.
- **Recomendación:** **QUITAR DE UI** (no hay lógica implementada en ninguna parte) o implementar.
- **Riesgo de dejarlo:** 🟠 Medio.

### ❌ DECORATIVO-5 — Filtro Divergencia SMT (doble bug)

- **UI:** [LeftSidebar.tsx:667-682](src/components/layout/LeftSidebar.tsx). Un único checkbox
  que setea **dos** estados a la vez: `setSmtDivergenceEnabled()` **y** `setSmtDivergenceCheck()`.
- **Por qué no funciona (doblemente):**
  1. `smtDivergenceCheck` llega al bridge ([mt5_bridge.py:1739](mt5_bridge.py)) pero **no se consume**.
  2. `smtDivergenceEnabled` se consume ([mt5_bridge.py:932](mt5_bridge.py)) pero **no llega**
     (snake_case, ver hallazgo crítico).
- **Recomendación:** Arreglar el mapeo de `smtDivergenceEnabled` (parte del fix de los 5 flags) y
  **eliminar el campo redundante `smtDivergenceCheck`** del store y del handler.
- **Riesgo de dejarlo:** 🔴 Alto: filtro de riesgo institucional que el usuario cree activo y nunca corre.

---

## 3. Parámetros CONDICIONALES (documentar dependencias)

| Parámetro | Depende del flag | Comportamiento si el flag está OFF | Nota |
|---|---|---|---|
| `partialClosePct` | `partialCloseAtEq` ([mt5_bridge.py:1176](mt5_bridge.py)) | El % se ignora (no hay cierre parcial) | El flag del que depende es ⚠️ HUÉRFANO → hoy `partialClosePct` es **inalcanzable en la práctica** |
| `modelTbsRiskMultiplier` | `sweep_type != None` ([mt5_bridge.py:1017](mt5_bridge.py)), que requiere `requireCandleConfirmation` | El lotaje no se multiplica (queda el de la UI) | El flag del que depende es ⚠️ HUÉRFANO → hoy **inerte** |
| `modelTwsRiskMultiplier` | igual que TBS | igual | igual → hoy **inerte** |

> **Importante:** estos 3 sí llegan correctamente al bridge (camelCase OK), pero su efecto está
> encadenado a flags HUÉRFANOS. **Arreglar el mapeo de los 5 flags (sección 2) los reactiva
> automáticamente** sin tocar estos tres.

---

## 4. Parámetros ACTIVOS (confirmados — lo que SÍ controla el usuario hoy)

| Parámetro | Función / línea que lo consume |
|---|---|
| `lotSize` | `volume = lot` [mt5_bridge.py:1014](mt5_bridge.py) |
| `takeProfitPips` / `stopLossPips` | cálculo TP/SL de la orden [mt5_bridge.py:958-994](mt5_bridge.py) |
| `maxPositions` | bloqueo del scanner [mt5_bridge.py:779-782](mt5_bridge.py) (⚠️ cuenta manuales) |
| `maxDailyLoss` | Risk Guard, límite efectivo [mt5_bridge.py:1340-1347](mt5_bridge.py) |
| `chromaThreshold` / `chromaTopK` | query semántica [mt5_bridge.py:960-961](mt5_bridge.py) (solo informativo, no bloquea) |
| `killzones` (toggles) | `validate_hard_rules` [mt5_bridge.py:350-356](mt5_bridge.py) + pre-filtro [L700-707](mt5_bridge.py) |
| `londonStart/End`, `newYorkStart/End`, `asianStart/End` | ventanas horarias [mt5_bridge.py:352-356](mt5_bridge.py), [L701-705](mt5_bridge.py) |
| `maxSpreadPoints` + `disableSpreadFilter` | filtro spread [mt5_bridge.py:381-382](mt5_bridge.py) |
| `minAtrPips` + `disableAtrFilter` | filtro ATR [mt5_bridge.py:403-404](mt5_bridge.py) |
| `maxWickBodyRatio` + `disableWickBodyFilter` | filtro mecha [mt5_bridge.py:417-418](mt5_bridge.py) |
| `disableDimensionFilter` + `minAmplitudeForexPct` + `minAmplitudeIndicesPoints` | filtro dimensión [mt5_bridge.py:442-444](mt5_bridge.py) |

> En resumen: **lo que funciona hoy** es el lotaje/TP/SL fijos, los límites de riesgo, las
> killzones/horarios y los 4 filtros de Capa 1 con sus bypass. ChromaDB clasifica pero no bloquea.

---

## 5. Decisiones Pendientes para el Usuario

1. **¿Arreglar el mapeo de los 5 flags CRT (camelCase) ahora?** Es el fix más rentable: 5 líneas
   en [mt5_bridge.py:1742-1746](mt5_bridge.py) reactivan TBS/TWS, SL dinámico, objetivos CRT,
   cierre parcial en EQ y SMT — más los 3 condicionales que dependen de ellos. **Recomendado: SÍ.**
2. **¿`smtDivergenceCheck` se elimina?** Es un campo redundante y muerto; el real es
   `smtDivergenceEnabled`. ¿Eliminar `smtDivergenceCheck` del store, UI y handler?
3. **¿Unificar los dos cierres parciales?** Hoy hay `partialClose` (viejo, decorativo) y
   `partialCloseAtEq` (nuevo, huérfano). ¿Dejar solo uno?
4. **¿Qué hacer con `strategy`?** ¿Conectar `IStrategy`/`STRATEGY_REGISTRY` al scanner, o quitar
   el selector hasta que exista más de una estrategia?
5. **¿`trailingStop`: implementar o quitar?** No tiene lógica en ningún lado.
6. **¿`hybridM1M15Confluence`: implementar o quitar?** Sin lógica.
7. **Etiqueta "UTC" de killzones.** La UI rotula los horarios como "(UTC)"
   ([LeftSidebar.tsx:537](src/components/layout/LeftSidebar.tsx), [L757](src/components/layout/LeftSidebar.tsx)),
   pero el bridge compara contra hora **Canaria** (`_to_canary`, [mt5_bridge.py:681](mt5_bridge.py)).
   Canary = UTC en invierno pero **UTC+1 en verano (DST)**. ¿Corregir la etiqueta a "Canary" o
   convertir realmente desde UTC?
8. **Inconsistencia de `overlap`.** El pre-filtro acepta la killzone `overlap` (12:00-15:00 fijo,
   [mt5_bridge.py:706-707](mt5_bridge.py)) pero `validate_hard_rules` **no la incluye** en sus
   ventanas ([mt5_bridge.py:350-356](mt5_bridge.py)). Con la config por defecto (london+overlap ON,
   newyork OFF), una señal entre 12:00-15:00 pasa el pre-filtro pero la rechaza Capa 1. Además no
   hay input de horario para `overlap`. ¿Añadir `overlap` a `validate_hard_rules` y darle input,
   o eliminar la killzone `overlap`?

---

## 6. Mapa de Drift de Configuración

Comparación entre las tres fuentes de configuración: `config_crt.json`, `BotConfig` (Python,
[mt5_bridge.py:44-91](mt5_bridge.py)) y `BotConfig` (TypeScript, [trading-store.ts:77-125](src/lib/store/trading-store.ts)).

### 6.1 Existe en `config_crt.json` pero NO en `BotConfig` (no configurable desde UI)

| Clave JSON | Valor | ¿Se consume? |
|---|---|---|
| `capa_1_hard_rules.timezone` | `"Atlantic/Canary"` | Sí (timezone del bridge) — pero no ajustable desde UI |
| `nine_am_model_cycle.*` | 14:00-15:30 | Sí, en `crt_logic.validate_hard_rules` [crt_logic.py:118-126](crt_logic.py) (ruta de backtest). Verificar si la `validate_hard_rules` inline del LIVE también lo lee |
| `spread_threshold.max_spread_to_ltf_atr_ratio` | `0.20` | Sí, vía `config_rules` [crt_logic.py:139](crt_logic.py) |
| `killzones.new_york_pm` | 18:00-21:00 | **Sesión PM existe en JSON pero NO en la UI ni en `BotConfig`** → inalcanzable |
| `tmt_magic_hour` | 15:00-16:00 | No encontrado consumidor |
| `dimension_restrictions.atr_filter.min_body_to_atr_ratio` | `0.10` | No encontrado consumidor (confirmado decorativo en RESUMEN_PROYECTO.md) |
| `allowed_structural_anchors` | lista | No encontrado consumidor |

### 6.2 Duplicado en JSON y en `BotConfig` (riesgo de divergencia silenciosa)

| Parámetro | `config_crt.json` | `BotConfig` (default) | Cuál gana en LIVE |
|---|---|---|---|
| `min_amplitude_forex_pct` | `0.08` ([config_crt.json:43](config_crt.json)) | `0.08` ([mt5_bridge.py:90](mt5_bridge.py)) | **BotConfig/UI** ([mt5_bridge.py:443](mt5_bridge.py)); el JSON queda como valor muerto |
| `min_amplitude_indices_points` | `20.0` ([config_crt.json:44](config_crt.json)) | `20.0` ([mt5_bridge.py:91](mt5_bridge.py)) | **BotConfig/UI** ([mt5_bridge.py:444](mt5_bridge.py)) |
| Pérdida diaria máx | `max_daily_loss_pct: 4.5` ([config_crt.json:60](config_crt.json)) | `max_daily_loss: 2.5` ([mt5_bridge.py:51](mt5_bridge.py)) | **BotConfig/UI**; el JSON solo es *fallback* si UI ≤ 0 ([mt5_bridge.py:1340-1347](mt5_bridge.py)). ⚠️ Defaults distintos (4.5 vs 2.5) |

### 6.3 `BotConfig` Python vs TypeScript

Coinciden campo a campo (snake_case ↔ camelCase) en los 36 parámetros. **La única ruptura es el
mapeo de los 5 flags CRT en el `payload.get` del handler** (ver hallazgo crítico). No hay campos
presentes en un dataclass y ausentes en el otro.

### 6.4 Doble implementación de `validate_hard_rules`

Existen **dos** funciones `validate_hard_rules`: una en [crt_logic.py:79-208](crt_logic.py)
(8 args, usada por el motor de backtest) y otra inline en `mt5_bridge.py` (4 args, usada por el
scanner LIVE, [mt5_bridge.py:914](mt5_bridge.py)). Leen los mismos campos pero son código
duplicado → riesgo de que LIVE y BACKTEST diverjan (p. ej., el manejo de `overlap` y `nine_am`
puede no ser idéntico). Candidato a unificación.

---

## Resumen de acciones (orden sugerido)

1. 🔴 **Fix mapeo 5 flags CRT** ([mt5_bridge.py:1742-1746](mt5_bridge.py) → camelCase). Reactiva
   toda la metodología CRT + 3 condicionales. ~5 líneas.
2. 🔴 Eliminar campo redundante `smtDivergenceCheck`; unificar los dos "cierre parcial".
3. 🟠 Decidir `strategy`, `trailingStop`, `hybridM1M15Confluence`: implementar o quitar de UI.
4. 🟠 Corregir etiqueta "UTC" vs hora Canary; resolver inconsistencia `overlap`.
5. 🟡 Limpiar drift de `config_crt.json` (valores muertos, `new_york_pm` sin UI); unificar las dos
   `validate_hard_rules`.
