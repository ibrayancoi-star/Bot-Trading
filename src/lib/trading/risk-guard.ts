import { useTradingStore } from "../store/trading-store";

export interface RiskGuardStatus {
  isBlocked: boolean;
  reason?: string;
}

/**
 * Evalúa las reglas de riesgo de The Trading Pit (u otra prop firm).
 * Congela operaciones automatizadas si se roza el 4% de Daily Drawdown.
 */
export function checkRiskGuard(): RiskGuardStatus {
  const state = useTradingStore.getState();
  const { config, risk, isBotActive, account } = state;

  // Si la cuenta ya está fallida, bloqueo absoluto
  if (account.status === "failed") {
    if (isBotActive) state.toggleBot();
    return {
      isBlocked: true,
      reason: "🚫 Cuenta suspendida: Se ha superado el límite de pérdida. Bot apagado.",
    };
  }

  // Límite de alerta temprana: 4% del balance inicial
  const fourPercentLimit = config.size * 0.04;
  
  // Computamos el PnL flotante actual en tiempo real
  const floatingPnL = state.positions.reduce((acc, p) => acc + p.pnl, 0);

  // Pérdida diaria actual = Límite máximo de pérdida diaria permitida - Lo que nos queda de margen
  // (Esto incluye PnL realizado de hoy + Drawdown flotante actual)
  const currentDailyLoss = (config.maxDailyLoss - risk.remainingDailyLoss) - (floatingPnL < 0 ? floatingPnL : 0);

  if (currentDailyLoss >= fourPercentLimit) {
    if (isBotActive) {
      console.warn(`🚨 [Risk Guard] Drawdown Diario en $${currentDailyLoss.toFixed(2)} (>= 4%). Apagando bot por seguridad.`);
      state.toggleBot();
    }
    return {
      isBlocked: true,
      reason: `⚠️ Riesgo Crítico: Drawdown Diario rozando el 4% ($${currentDailyLoss.toFixed(2)} perdidos). Nuevas operaciones bloqueadas.`,
    };
  }

  return { isBlocked: false };
}
