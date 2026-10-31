// Canonical sport types. Upstream sport names are normalised with toSport();
// display labels live in the dictionaries (t.sports) and icons in
// components/sport-icon.tsx. Anything unrecognised is "other".

export const SPORT_TYPES = [
  "ride",
  "virtual_ride",
  "run",
  "virtual_run",
  "walk",
  "hike",
  "swim",
  "row",
  "strength",
  "hiit",
  "yoga",
  "stretching",
  "ski",
  "snowboard",
  "skating",
  "climbing",
  "racket",
  "soccer",
  "basketball",
  "volleyball",
  "golf",
  "martial_arts",
  "other",
] as const;

export type Sport = (typeof SPORT_TYPES)[number];

const RULES: [RegExp, Sport][] = [
  [/virtual.?ride|indoor.?(cycl|bik)|zwift|trainer|spin|stationary/i, "virtual_ride"],
  [/virtual.?run|treadmill|indoor.?run/i, "virtual_run"],
  [/row|kayak|canoe|paddl|sup\b/i, "row"],
  [/e-?bike|mountain.?bik|gravel|road.?bik|cycl|bik|ride/i, "ride"],
  [/trail.?run|run|jog/i, "run"],
  [/hik|trek/i, "hike"],
  [/walk/i, "walk"],
  [/swim/i, "swim"],
  [/weight|strength|functional|crossfit|powerlift|gym/i, "strength"],
  [/hiit|interval|bootcamp|circuit/i, "hiit"],
  [/yoga|pilates/i, "yoga"],
  [/stretch|mobility|flexib/i, "stretching"],
  [/snowboard/i, "snowboard"],
  [/ski/i, "ski"],
  [/skat/i, "skating"],
  [/climb|boulder/i, "climbing"],
  [/tennis|padel|squash|badminton|pickleball|racquet|racket|table.?tennis/i, "racket"],
  [/soccer|football|futsal/i, "soccer"],
  [/basketball/i, "basketball"],
  [/volleyball/i, "volleyball"],
  [/golf/i, "golf"],
  [/martial|karate|box|judo|taekwondo|jiu.?jitsu|mma|kung.?fu/i, "martial_arts"],
];

export function toSport(raw: string | null | undefined): Sport {
  if (!raw) return "other";
  for (const [re, sport] of RULES) if (re.test(raw)) return sport;
  return "other";
}

export function isSport(v: string): v is Sport {
  return (SPORT_TYPES as readonly string[]).includes(v);
}

// Whether two activities with these sports could be the same real workout.
export function sportsCompatible(a: Sport, b: Sport): boolean {
  if (a === b || a === "other" || b === "other") return true;
  const family = (s: Sport) => (s === "virtual_ride" ? "ride" : s === "virtual_run" ? "run" : s === "hike" ? "walk" : s === "snowboard" ? "ski" : s);
  return family(a) === family(b);
}
