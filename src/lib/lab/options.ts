import type { LabCopy } from "@/i18n/lab";
import { MARKERS, unitsOf } from "./markers";

// Marker choices for forms, in the user's language, alphabetical.
export function markerOptions(copy: LabCopy) {
  return MARKERS.map((m) => ({ code: m.code, name: (copy.items[m.code as keyof LabCopy["items"]] as { name?: string }).name ?? m.code, units: unitsOf(m.code) })).sort((a, b) => a.name.localeCompare(b.name));
}
