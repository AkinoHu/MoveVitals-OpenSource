import {
  IconActivity,
  IconBallBasketball,
  IconBallFootball,
  IconBallTennis,
  IconBallVolleyball,
  IconBarbell,
  IconBike,
  IconFlame,
  IconGolf,
  IconIceSkating,
  IconKarate,
  IconKayak,
  IconMountain,
  IconRun,
  IconSkiJumping,
  IconSnowboarding,
  IconStretching,
  IconSwimming,
  IconTreadmill,
  IconTrekking,
  IconWalk,
  IconYoga,
  type Icon,
} from "@tabler/icons-react";
import { isSport, type Sport } from "@/lib/sports";

const ICONS: Record<Sport, Icon> = {
  ride: IconBike,
  virtual_ride: IconBike,
  run: IconRun,
  virtual_run: IconTreadmill,
  walk: IconWalk,
  hike: IconTrekking,
  swim: IconSwimming,
  row: IconKayak,
  strength: IconBarbell,
  hiit: IconFlame,
  yoga: IconYoga,
  stretching: IconStretching,
  ski: IconSkiJumping,
  snowboard: IconSnowboarding,
  skating: IconIceSkating,
  climbing: IconMountain,
  racket: IconBallTennis,
  soccer: IconBallFootball,
  basketball: IconBallBasketball,
  volleyball: IconBallVolleyball,
  golf: IconGolf,
  martial_arts: IconKarate,
  other: IconActivity,
};

export function SportIcon({ sport, size = 16, className = "" }: { sport: string; size?: number; className?: string }) {
  const Cmp = ICONS[isSport(sport) ? sport : "other"];
  return <Cmp size={size} stroke={1.75} aria-hidden className={`shrink-0 ${className}`} />;
}

// Icon in a small rounded tile; indoor sessions get a subtle dot.
export function SportBadge({ sport, size = 28 }: { sport: string; size?: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center rounded-lg bg-surface-3 text-ink" style={{ width: size, height: size }}>
      <SportIcon sport={sport} size={Math.round(size * 0.58)} />
      {(sport === "virtual_ride" || sport === "virtual_run") && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full border-2 border-surface bg-accent" />}
    </span>
  );
}
