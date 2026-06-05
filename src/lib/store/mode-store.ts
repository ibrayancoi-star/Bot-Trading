"use client";

import { create } from "zustand";

export type DashboardMode = "DEMO" | "BACKTEST" | "LIVE";

interface ModeState {
  mode: DashboardMode;
  setMode: (mode: DashboardMode) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  mode: "DEMO",
  setMode: (mode) => set({ mode }),
}));
