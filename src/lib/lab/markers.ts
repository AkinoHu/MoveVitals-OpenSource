// Body Lab catalogue: lab biomarkers, the wearable metrics that sit beside
// them, and the ten body domains they are grouped into.
//
// Values are stored in each marker's canonical unit. Default reference ranges
// are typical adult ranges from widely used clinical sources (noted per
// marker); a range printed on the user's own report always takes precedence.
// Labels and explanations live in src/i18n/lab/<locale>.ts.

export type Sex = "male" | "female";
export type Range = { low?: number; high?: number };
type Conv = { to: (v: number) => number; from: (v: number) => number };

export type MarkerDef = {
  code: string;
  unit: string;
  // Other units a report may use, converted to the canonical unit.
  units?: Record<string, Conv>;
  decimals: number;
  ref?: Range;
  refBySex?: Record<Sex, Range>;
  // Wearable metric this marker can be compared with (calibration / context).
  metric?: string;
  // Guide slug key (content/guides/<key>.md) explaining the marker.
  guide?: string;
  // Suggested months between tests for a healthy adult.
  every: number;
};

const factor = (f: number): Conv => ({ to: (v) => v * f, from: (v) => v / f });

export const MARKERS: MarkerDef[] = [
  // Lipids — NCEP ATP III / ESC 2019 / NLA
  { code: "total_cholesterol", unit: "mg/dL", units: { "mmol/L": factor(38.67) }, decimals: 0, ref: { high: 200 }, guide: "lab-cholesterol", every: 12 },
  { code: "ldl_c", unit: "mg/dL", units: { "mmol/L": factor(38.67) }, decimals: 0, ref: { high: 100 }, guide: "lab-cholesterol", every: 12 },
  { code: "hdl_c", unit: "mg/dL", units: { "mmol/L": factor(38.67) }, decimals: 0, refBySex: { male: { low: 40 }, female: { low: 50 } }, guide: "lab-cholesterol", every: 12 },
  { code: "triglycerides", unit: "mg/dL", units: { "mmol/L": factor(88.57) }, decimals: 0, ref: { high: 150 }, guide: "lab-cholesterol", every: 12 },
  { code: "apob", unit: "mg/dL", units: { "g/L": factor(100) }, decimals: 0, ref: { high: 90 }, guide: "lab-apob", every: 12 },
  // Lp(a) is genetically fixed: one test in a lifetime is usually enough.
  // mg/dL ↔ nmol/L has no exact factor; 2.15 is the commonly used approximation.
  { code: "lp_a", unit: "nmol/L", units: { "mg/dL": factor(2.15) }, decimals: 0, ref: { high: 75 }, guide: "lab-apob", every: 120 },
  // Glucose metabolism — ADA Standards of Care
  { code: "fasting_glucose", unit: "mg/dL", units: { "mmol/L": factor(18.016) }, decimals: 0, ref: { low: 70, high: 99 }, guide: "lab-hba1c", every: 12 },
  { code: "hba1c", unit: "%", units: { "mmol/mol": { to: (v) => v / 10.929 + 2.15, from: (v) => (v - 2.15) * 10.929 } }, decimals: 1, ref: { high: 5.6 }, metric: "blood_glucose", guide: "lab-hba1c", every: 12 },
  { code: "fasting_insulin", unit: "µIU/mL", units: { "pmol/L": factor(1 / 6) }, decimals: 1, ref: { low: 2, high: 20 }, guide: "lab-hba1c", every: 12 },
  // Inflammation and blood — AHA/CDC hs-CRP risk bands; Mayo Clinic Laboratories
  { code: "hs_crp", unit: "mg/L", units: { "mg/dL": factor(10) }, decimals: 1, ref: { high: 3 }, guide: "lab-hs-crp", every: 12 },
  { code: "hemoglobin", unit: "g/dL", units: { "g/L": factor(0.1), "mmol/L": factor(1.611) }, decimals: 1, refBySex: { male: { low: 13.2, high: 16.6 }, female: { low: 11.6, high: 15 } }, guide: "lab-ferritin", every: 12 },
  // Hormones — American Thyroid Association; AUA testosterone guideline
  { code: "tsh", unit: "mIU/L", units: { "µIU/mL": factor(1) }, decimals: 2, ref: { low: 0.4, high: 4 }, guide: "lab-thyroid", every: 24 },
  { code: "free_t4", unit: "ng/dL", units: { "pmol/L": factor(1 / 12.87) }, decimals: 2, ref: { low: 0.8, high: 1.8 }, guide: "lab-thyroid", every: 24 },
  { code: "testosterone", unit: "ng/dL", units: { "nmol/L": factor(28.84) }, decimals: 0, refBySex: { male: { low: 264, high: 916 }, female: { low: 15, high: 70 } }, guide: "lab-testosterone", every: 24 },
  // Micronutrients — Endocrine Society (vitamin D); WHO (ferritin); Harris & von Schacky (omega-3 index)
  { code: "vitamin_d", unit: "ng/mL", units: { "nmol/L": factor(1 / 2.496) }, decimals: 0, ref: { low: 30, high: 100 }, guide: "lab-vitamin-d", every: 12 },
  { code: "ferritin", unit: "ng/mL", units: { "µg/L": factor(1) }, decimals: 0, refBySex: { male: { low: 30, high: 400 }, female: { low: 15, high: 150 } }, guide: "lab-ferritin", every: 12 },
  { code: "vitamin_b12", unit: "pg/mL", units: { "pmol/L": factor(1 / 0.738) }, decimals: 0, ref: { low: 200, high: 900 }, guide: "lab-vitamin-d", every: 24 },
  { code: "omega3_index", unit: "%", decimals: 1, ref: { low: 8 }, guide: "lab-omega-3-index", every: 12 },
  // Liver and kidney — Mayo Clinic Laboratories; KDIGO (eGFR)
  { code: "alt", unit: "U/L", decimals: 0, ref: { low: 7, high: 55 }, guide: "lab-liver-kidney", every: 12 },
  { code: "ast", unit: "U/L", decimals: 0, ref: { low: 8, high: 48 }, guide: "lab-liver-kidney", every: 12 },
  { code: "creatinine", unit: "mg/dL", units: { "µmol/L": factor(1 / 88.4) }, decimals: 2, refBySex: { male: { low: 0.74, high: 1.35 }, female: { low: 0.59, high: 1.04 } }, guide: "lab-liver-kidney", every: 12 },
  { code: "egfr", unit: "mL/min/1.73m²", decimals: 0, ref: { low: 60 }, guide: "lab-liver-kidney", every: 12 },
  // Measured tests that calibrate wearables
  { code: "dexa_body_fat", unit: "%", decimals: 1, refBySex: { male: { low: 8, high: 20 }, female: { low: 21, high: 33 } }, metric: "body_fat", guide: "lab-dexa", every: 12 },
  { code: "vo2max_lab", unit: "ml/kg/min", decimals: 1, metric: "vo2max", guide: "vo2max", every: 12 },
];

export const MARKER_MAP: Record<string, MarkerDef> = Object.fromEntries(MARKERS.map((m) => [m.code, m]));

// Typical adult ranges for wearable metrics shown in the Lab (AHA, AASM,
// American Lung Association). Personal baselines matter more for these.
export const METRIC_REFS: Record<string, Range> = {
  resting_hr: { low: 40, high: 80 },
  bp_systolic: { high: 120 },
  bp_diastolic: { high: 80 },
  spo2: { low: 95 },
  respiratory_rate: { low: 12, high: 20 },
  sleep_duration: { low: 7 * 3600, high: 9 * 3600 },
  sleep_efficiency: { low: 85 },
  glucose_tir: { low: 70 },
};

// Guide (content/guides/<key>.md) explaining each wearable metric.
export const METRIC_GUIDES: Record<string, string> = {
  vo2max: "vo2max",
  resting_hr: "resting-heart-rate",
  hrv_rmssd: "hrv",
  bp_systolic: "blood-pressure",
  bp_diastolic: "blood-pressure",
  blood_glucose: "blood-glucose",
  glucose_tir: "glucose-time-in-range",
  sleep_duration: "sleep-duration",
  sleep_efficiency: "sleep-efficiency",
  respiratory_rate: "respiratory-rate",
  spo2: "spo2",
  weight: "body-weight",
  body_fat: "body-fat",
  muscle_mass: "muscle-mass",
};

export type DomainItem = { marker: string } | { metric: string };
export type Domain = { code: string; items: DomainItem[] };

export const DOMAINS: Domain[] = [
  { code: "fitness", items: [{ metric: "vo2max" }, { marker: "vo2max_lab" }, { metric: "resting_hr" }] },
  { code: "heart", items: [{ metric: "hrv_rmssd" }, { metric: "bp_systolic" }, { metric: "bp_diastolic" }] },
  { code: "lipids", items: [{ marker: "apob" }, { marker: "ldl_c" }, { marker: "hdl_c" }, { marker: "triglycerides" }, { marker: "total_cholesterol" }, { marker: "lp_a" }] },
  { code: "metabolic", items: [{ marker: "hba1c" }, { marker: "fasting_glucose" }, { marker: "fasting_insulin" }, { metric: "blood_glucose" }, { metric: "glucose_tir" }] },
  { code: "sleep", items: [{ metric: "sleep_duration" }, { metric: "sleep_efficiency" }, { metric: "respiratory_rate" }, { metric: "spo2" }] },
  { code: "body", items: [{ metric: "weight" }, { metric: "body_fat" }, { marker: "dexa_body_fat" }, { metric: "muscle_mass" }] },
  { code: "inflammation", items: [{ marker: "hs_crp" }, { marker: "hemoglobin" }] },
  { code: "hormones", items: [{ marker: "tsh" }, { marker: "free_t4" }, { marker: "testosterone" }] },
  { code: "nutrients", items: [{ marker: "vitamin_d" }, { marker: "ferritin" }, { marker: "vitamin_b12" }, { marker: "omega3_index" }] },
  { code: "organs", items: [{ marker: "egfr" }, { marker: "creatinine" }, { marker: "alt" }, { marker: "ast" }] },
];

export const itemCode = (i: DomainItem) => ("marker" in i ? i.marker : i.metric);

// Converts a value in `unit` to the marker's canonical unit; null when the
// unit is unknown for this marker.
export function toCanonical(code: string, value: number, unit: string): number | null {
  const m = MARKER_MAP[code];
  if (!m) return null;
  const norm = (u: string) => u.replace(/\s+/g, "").replace("μ", "µ").replace(/^u/, "µ").toLowerCase();
  if (norm(unit) === norm(m.unit)) return value;
  const entry = Object.entries(m.units ?? {}).find(([u]) => norm(u) === norm(unit));
  return entry ? entry[1].to(value) : null;
}

export function unitsOf(code: string): string[] {
  const m = MARKER_MAP[code];
  return m ? [m.unit, ...Object.keys(m.units ?? {})] : [];
}

export function refFor(code: string, sex?: string | null, printed?: Range | null): Range | null {
  if (printed && (printed.low != null || printed.high != null)) return printed;
  const m = MARKER_MAP[code];
  if (m) return (sex === "male" || sex === "female" ? m.refBySex?.[sex] : undefined) ?? m.ref ?? null;
  return METRIC_REFS[code] ?? null;
}

export type Flag = "low" | "high" | "in";

export function flagOf(value: number, ref: Range | null): Flag | null {
  if (!ref) return null;
  if (ref.low != null && value < ref.low) return "low";
  if (ref.high != null && value > ref.high) return "high";
  return "in";
}

export function formatMarker(code: string, value: number): string {
  const m = MARKER_MAP[code];
  return value.toFixed(m?.decimals ?? 1);
}
