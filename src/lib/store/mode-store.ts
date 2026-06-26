"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DashboardMode = "DEMO" | "BACKTEST" | "LIVE";

interface ModeState {
  mode: DashboardMode;
  setMode: (mode: DashboardMode) => void;
}

export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      mode: "DEMO",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "ttp-gratis-mode-state",
      partialize: (s) => ({ mode: s.mode }),
    },
  ),
);
