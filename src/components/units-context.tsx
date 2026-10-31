"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { UnitSystem } from "@/lib/units";

const UnitsContext = createContext<UnitSystem>("metric");

export function UnitsProvider({ units, children }: { units: UnitSystem; children: ReactNode }) {
  return <UnitsContext value={units}>{children}</UnitsContext>;
}

export const useUnits = () => useContext(UnitsContext);
