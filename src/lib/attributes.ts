// Body profile attributes. Values are stored as strings and validated here.

export const ATTRIBUTES = {
  height_cm: { kind: "number", min: 50, max: 260, step: 0.5 },
  birth_date: { kind: "date" },
  sex: { kind: "enum", options: ["female", "male", "other"] },
  blood_type: { kind: "enum", options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
  max_hr: { kind: "number", min: 100, max: 240, step: 1 },
  ftp_w: { kind: "number", min: 50, max: 600, step: 1 },
} as const;

export type AttributeKey = keyof typeof ATTRIBUTES;
export const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES) as AttributeKey[];

export function isAttributeKey(k: string): k is AttributeKey {
  return k in ATTRIBUTES;
}

// Normalised value, or null if invalid.
export function normaliseAttribute(key: AttributeKey, raw: string): string | null {
  const def = ATTRIBUTES[key];
  const v = raw.trim();
  if (!v) return null;
  if (def.kind === "number") {
    const n = Number(v);
    return Number.isFinite(n) && n >= def.min && n <= def.max ? String(Math.round(n * 10) / 10) : null;
  }
  if (def.kind === "date") {
    const d = new Date(`${v}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d < new Date() && d.getUTCFullYear() > 1900 ? v : null;
  }
  return (def.options as readonly string[]).includes(v) ? v : null;
}

export function ageFrom(birthDate: string | undefined, now = new Date()): number | null {
  if (!birthDate) return null;
  const b = new Date(`${birthDate}T00:00:00Z`);
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
