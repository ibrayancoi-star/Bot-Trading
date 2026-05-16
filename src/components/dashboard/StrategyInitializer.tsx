"use client";

import { useEffect } from "react";
import { startStrategyRunner, stopStrategyRunner } from "@/lib/strategies/runner";

export function StrategyInitializer() {
  useEffect(() => {
    startStrategyRunner();
    return () => {
      stopStrategyRunner();
    };
  }, []);

  return null;
}
