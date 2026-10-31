import type { Dict } from "./dict/en";

// Resolves "auth.errEmail" against a dictionary; unknown keys (e.g. raw
// provider error messages) are returned unchanged.
export function tr(t: Dict, key: string | undefined): string {
  if (!key) return "";
  const v = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), t);
  return typeof v === "string" ? v : key;
}
