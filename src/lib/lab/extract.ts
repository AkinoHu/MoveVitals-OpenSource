// Reads biomarkers from an uploaded lab report with the user's own model.
// Nothing is saved from here: results come back as candidates that the user
// reviews and confirms one by one.

import { callModel, type Attachment } from "@/lib/ai";
import type { aiSettings, ExtractedMarker } from "@/lib/db/schema";
import { MARKERS } from "./markers";

const SYSTEM = `You extract laboratory results from medical documents into JSON. Copy numbers exactly as printed; never estimate, convert or invent values. If the document contains no lab values, return [].`;

function prompt(): string {
  const list = MARKERS.filter((m) => m.code !== "vo2max_lab").map((m) => `- ${m.code} (usual units: ${[m.unit, ...Object.keys(m.units ?? {})].join(", ")})`);
  return [
    "Find these markers in the attached report (names vary by lab and language, e.g. LDL-C / 低密度脂蛋白胆固醇, HbA1c / 糖化血红蛋白, 25-OH vitamin D):",
    ...list,
    "",
    "Return ONLY a JSON array, no prose. One object per value found:",
    '{"marker": "<code from the list>", "printed": "<name as printed>", "value": <number>, "unit": "<unit as printed>", "refLow": <number|null>, "refHigh": <number|null>, "takenOn": "<YYYY-MM-DD collection date or null>"}',
    "Use the reference range printed next to the value when there is one (\"<5.7\" → refHigh 5.7). Skip markers not in the list.",
  ].join("\n");
}

export async function extractMarkers(settings: typeof aiSettings.$inferSelect, file: Attachment): Promise<ExtractedMarker[]> {
  const text = await callModel(settings, SYSTEM, prompt(), [file]);
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  if (!json) throw new Error("dash.lab.errExtractEmpty");
  const known = new Set(MARKERS.map((m) => m.code));
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const out: ExtractedMarker[] = [];
  for (const raw of JSON.parse(json) as Record<string, unknown>[]) {
    const value = num(raw.value);
    if (typeof raw.marker !== "string" || !known.has(raw.marker) || value == null) continue;
    const day = typeof raw.takenOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.takenOn) ? raw.takenOn : null;
    out.push({ marker: raw.marker, printed: String(raw.printed ?? raw.marker).slice(0, 120), value, unit: String(raw.unit ?? "").slice(0, 40), refLow: num(raw.refLow), refHigh: num(raw.refHigh), takenOn: day });
  }
  return out;
}
