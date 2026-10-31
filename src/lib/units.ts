// Metric / imperial display. Data is always stored in SI-style metric units;
// conversion happens only when formatting for the user.

export type UnitSystem = "metric" | "imperial";
export const UNIT_SYSTEMS: UnitSystem[] = ["metric", "imperial"];

export function isUnitSystem(v: unknown): v is UnitSystem {
  return v === "metric" || v === "imperial";
}

const KG_TO_LB = 2.2046226218;
const M_TO_FT = 3.280839895;
const KM_TO_MI = 0.6213711922;

// How a stored metric unit is shown in imperial: value transform + label.
const IMPERIAL: Record<string, { unit: string; to: (v: number) => number; decimals?: number }> = {
  kg: { unit: "lb", to: (v) => v * KG_TO_LB, decimals: 1 },
  "°C": { unit: "°F", to: (v) => v * 1.8 + 32, decimals: 1 },
  cm: { unit: "in", to: (v) => v / 2.54, decimals: 1 },
};

// Temperature *differences* scale without the +32 offset.
const DELTA_METRICS = new Set(["temp_deviation"]);

export function convertMetricValue(metricUnit: string, code: string, value: number, units: UnitSystem): { value: number; unit: string; decimals?: number } {
  if (units === "metric") return { value, unit: metricUnit };
  if (metricUnit === "°C" && DELTA_METRICS.has(code)) return { value: value * 1.8, unit: "°F", decimals: 2 };
  const c = IMPERIAL[metricUnit];
  return c ? { value: c.to(value), unit: c.unit, decimals: c.decimals } : { value, unit: metricUnit };
}

export function formatDistance(meters: number | null | undefined, units: UnitSystem, decimals = 1): string {
  if (meters == null) return "—";
  return units === "imperial" ? `${((meters / 1000) * KM_TO_MI).toFixed(decimals)} mi` : `${(meters / 1000).toFixed(decimals)} km`;
}

export function formatElevation(meters: number | null | undefined, units: UnitSystem): string {
  if (meters == null) return "—";
  return units === "imperial" ? `${Math.round(meters * M_TO_FT)} ft` : `${Math.round(meters)} m`;
}

export function formatSpeed(metersPerSecond: number | null | undefined, units: UnitSystem): string {
  if (metersPerSecond == null) return "—";
  const kmh = metersPerSecond * 3.6;
  return units === "imperial" ? `${(kmh * KM_TO_MI).toFixed(1)} mph` : `${kmh.toFixed(1)} km/h`;
}

export function metersTo(units: UnitSystem, meters: number): number {
  return units === "imperial" ? meters * M_TO_FT : meters;
}

export const elevationUnit = (units: UnitSystem) => (units === "imperial" ? "ft" : "m");

// Height for forms: cm ⇄ feet + inches.
export function cmToFeetInches(cm: number): { ft: number; inch: number } {
  const totalIn = cm / 2.54;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round((totalIn - ft * 12) * 10) / 10;
  if (inch >= 12) {
    ft += 1;
    inch -= 12;
  }
  return { ft, inch };
}

export function feetInchesToCm(ft: number, inch: number): number {
  return (ft * 12 + inch) * 2.54;
}

export function formatHeight(cm: number | null | undefined, units: UnitSystem): string {
  if (cm == null) return "—";
  if (units === "metric") return `${Math.round(cm)} cm`;
  const { ft, inch } = cmToFeetInches(cm);
  return `${ft}′ ${Math.round(inch)}″`;
}
