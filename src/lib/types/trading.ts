import { Timeframe } from "./market";

export type SignalSide = "BUY" | "SELL" | "CLOSE";

export interface Signal {
  id: string;
  strategyId: string;
  symbol: string;
  side: SignalSide;
  price: number;
  timestamp: number;
  timeframe: Timeframe;
  confidence: number; // 0 to 1
  status: "pending" | "sent" | "executed" | "filled" | "error";
  error?: string;
}

export interface TTPChallenge {
  id: string;
  name: string;
  size: number;
  dailyDrawdownLimit: number; // percentage
  maxDrawdownLimit: number; // percentage
  profitTarget: number; // percentage
  maxDailyLoss: number; // amount
  maxOverallLoss: number; // amount
}

export type BrokerConnectionStatus = "connected" | "disconnected" | "connecting" | "error";

export interface BrokerConnection {
  status: BrokerConnectionStatus;
  lastSync?: number;
  error?: string;
}

export interface TradeResult {
  id: string;
  symbol: string;
  type: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  lotSize: number;
  pnl: number;
  pnlPercentage: number;
  duration: number; // in seconds
  closedAt: number;
}
