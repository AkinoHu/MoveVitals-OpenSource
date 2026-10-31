import { siAndroid, siApple, siFitbit, siGarmin, siHevy, siHuawei, siPeloton, siSamsung, siStrava, siXiaomi } from "simple-icons";
import { CATALOG_MAP } from "@/lib/providers/catalog";

// Official marks: Simple Icons (CC0 vector marks) where available, otherwise
// the icon published on the brand's own website (scripts/fetch-brand-icons.mjs).
const VECTOR: Record<string, { path: string; hex: string }> = {
  strava: siStrava,
  garmin: siGarmin,
  apple_health: siApple,
  google_health: siFitbit,
  huawei: siHuawei,
  samsung_health: siSamsung,
  xiaomi: siXiaomi,
  health_connect: siAndroid,
  peloton: siPeloton,
  hevy: siHevy,
};

const IMAGE: Record<string, string> = {
  whoop: "/brands/whoop.png",
  polar: "/brands/polar.png",
  polar_ble: "/brands/polar.png",
  oura: "/brands/oura.png",
  withings: "/brands/withings.png",
  suunto: "/brands/suunto.png",
  concept2: "/brands/concept2.png",
  dexcom: "/brands/dexcom.png",
  zwift: "/brands/zwift.png",
  coros: "/brands/coros.svg",
  zepp: "/brands/zepp.png",
  ultrahuman: "/brands/ultrahuman.svg",
  trainingpeaks: "/brands/trainingpeaks.png",
  rouvy: "/brands/rouvy.png",
  magene: "/brands/magene.png",
  intervals_icu: "/brands/intervals_icu.svg",
};

// Monochrome by default; the brand's own colours appear on hover of any
// ancestor with the `group` class (pass `color` to always show them).
export function BrandIcon({ id, size = 20, color = false, className = "" }: { id: string; size?: number; color?: boolean; className?: string }) {
  const name = CATALOG_MAP[id]?.name ?? id;
  const vec = VECTOR[id];
  if (vec) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={name} className={`shrink-0 ${className}`}>
        <path
          d={vec.path}
          className={color ? "" : "fill-ink transition-colors group-hover:fill-[var(--brand)]"}
          style={{ ["--brand" as string]: `#${vec.hex}`, fill: color ? `#${vec.hex}` : undefined }}
        />
      </svg>
    );
  }
  const src = IMAGE[id];
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={`shrink-0 rounded-[22%] object-contain ${color ? "" : "grayscale transition group-hover:grayscale-0"} ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  // No usable official icon: a quiet wordmark tile.
  return (
    <span
      aria-label={name}
      className={`inline-grid shrink-0 place-items-center rounded-[22%] bg-ink font-semibold tracking-tight text-bg ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
