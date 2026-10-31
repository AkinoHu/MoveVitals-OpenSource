import { convertMetricValue, type UnitSystem } from "./units";

// Canonical metric catalogue. Every adapter maps upstream fields onto these
// codes so values from different sources can be compared and resolved.

export type MetricCategory = "recovery" | "sleep" | "heart" | "activity" | "body" | "vitals" | "metabolic";

export type MetricDef = {
  code: string;
  label: string; // zh-CN display label
  unit: string;
  category: MetricCategory;
  // Relative difference above which two sources are considered to disagree.
  tolerance: number;
  // How to roll several same-day values from ONE source into one daily value.
  dailyAgg: "last" | "sum" | "avg" | "max" | "min";
  decimals: number;
};

const m = (
  code: string,
  label: string,
  unit: string,
  category: MetricCategory,
  tolerance: number,
  dailyAgg: MetricDef["dailyAgg"] = "last",
  decimals = 0,
): MetricDef => ({ code, label, unit, category, tolerance, dailyAgg, decimals });

export const METRICS: MetricDef[] = [
  m("recovery_score", "恢复分", "%", "recovery", 0.1),
  m("readiness_score", "准备度", "score", "recovery", 0.1),
  m("strain", "Strain", "score", "recovery", 0.1, "last", 1),
  m("hrv_rmssd", "HRV (RMSSD)", "ms", "heart", 0.1, "last", 0),
  // Apple Health stores SDNN — a different statistic, never mixed with RMSSD.
  m("hrv_sdnn", "HRV (SDNN)", "ms", "heart", 0.1, "last", 0),
  m("resting_hr", "静息心率", "bpm", "heart", 0.06),
  m("sleep_duration", "睡眠时长", "s", "sleep", 0.08, "sum"),
  m("sleep_deep", "深睡", "s", "sleep", 0.2, "sum"),
  m("sleep_rem", "REM", "s", "sleep", 0.2, "sum"),
  m("sleep_light", "浅睡", "s", "sleep", 0.2, "sum"),
  m("sleep_awake", "清醒", "s", "sleep", 0.3, "sum"),
  m("sleep_efficiency", "睡眠效率", "%", "sleep", 0.05),
  m("sleep_score", "睡眠分", "score", "sleep", 0.1),
  m("respiratory_rate", "呼吸频率", "rpm", "vitals", 0.08, "last", 1),
  m("spo2", "血氧", "%", "vitals", 0.02, "avg", 1),
  m("skin_temp", "皮肤温度", "°C", "vitals", 0.02, "avg", 1),
  m("temp_deviation", "体温偏差", "°C", "vitals", 0.5, "last", 2),
  m("body_temp", "体温", "°C", "vitals", 0.01, "avg", 1),
  m("steps", "步数", "count", "activity", 0.1, "max"),
  m("active_energy", "活动消耗", "kcal", "activity", 0.15, "max"),
  m("total_energy", "总消耗", "kcal", "activity", 0.1, "max"),
  m("weight", "体重", "kg", "body", 0.01, "last", 1),
  m("body_fat", "体脂率", "%", "body", 0.05, "last", 1),
  m("muscle_mass", "肌肉量", "kg", "body", 0.03, "last", 1),
  m("bone_mass", "骨量", "kg", "body", 0.05, "last", 2),
  m("hydration", "水分", "kg", "body", 0.05, "last", 1),
  m("bp_systolic", "收缩压", "mmHg", "vitals", 0.05, "avg"),
  m("bp_diastolic", "舒张压", "mmHg", "vitals", 0.05, "avg"),
  m("heart_rate", "心率", "bpm", "heart", 0.1, "avg"),
  m("vo2max", "最大摄氧量", "ml/kg/min", "metabolic", 0.05, "last", 1),
  m("blood_glucose", "血糖", "mg/dL", "metabolic", 0.1, "avg"),
  m("glucose_tir", "血糖达标时间", "%", "metabolic", 0.1, "avg"),
  m("stress", "压力", "score", "recovery", 0.2, "avg"),
  m("body_battery", "Body Battery", "score", "recovery", 0.2, "max"),
];

export const METRIC_MAP: Record<string, MetricDef> = Object.fromEntries(METRICS.map((d) => [d.code, d]));

export const CATEGORY_LABELS: Record<MetricCategory, string> = {
  recovery: "恢复",
  sleep: "睡眠",
  heart: "心脏",
  activity: "日常活动",
  body: "身体成分",
  vitals: "生命体征",
  metabolic: "代谢",
};

// Value in the user's unit system (no-op for metric).
export function toDisplay(code: string, value: number, units: UnitSystem = "metric"): number {
  const def = METRIC_MAP[code];
  return def ? convertMetricValue(def.unit, code, value, units).value : value;
}

// `converted` = the value is already in display units (see toDisplay).
export function formatMetric(code: string, value: number | null | undefined, units: UnitSystem = "metric", converted = false): string {
  if (value == null || Number.isNaN(value)) return "—";
  const def = METRIC_MAP[code];
  if (!def) return String(value);
  if (def.unit === "s") {
    const h = Math.floor(value / 3600);
    const min = Math.round((value % 3600) / 60);
    return h > 0 ? `${h}h ${min}m` : `${min}m`;
  }
  const c = convertMetricValue(def.unit, code, value, units);
  const shown = converted ? value : c.value;
  const n = shown.toFixed(c.decimals ?? def.decimals);
  return def.unit === "score" || def.unit === "count" ? n : `${n} ${c.unit}`;
}
