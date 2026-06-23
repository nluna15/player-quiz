import quizData from "@/data/quiz-data.json";

export type Player = {
  id: number;
  name: string;
  photoUrl: string;
  club: string;
  countryCode: string;
};

export type Country = {
  code: string;
  name: string;
  flag: string;
};

const data = quizData as { countries: Country[]; players: Player[] };

/** Today's date as YYYY-MM-DD in UTC, so the daily set rolls over consistently for everyone. */
export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The day the game launched — puzzle #1. */
export const LAUNCH_DATE = "2026-06-23";

/**
 * Sequential puzzle number for a given date, counting from launch day (#1).
 * Used in the share text, e.g. "Roster Quiz #12".
 */
export function getPuzzleNumber(dateStr: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = Date.parse(`${LAUNCH_DATE}T00:00:00Z`);
  const today = Date.parse(`${dateStr}T00:00:00Z`);
  return Math.floor((today - start) / msPerDay) + 1;
}

/** Deterministic 32-bit hash of a string (cyrb53-lite). */
function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** mulberry32 seeded PRNG → returns a function producing floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle using the supplied PRNG (does not mutate input). */
function shuffle<T>(items: T[], rand: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick 6 players for the given date — each from a distinct club AND a distinct country,
 * so the six answers are all different. Deterministic for a given dateStr.
 */
export function getDailyPlayers(dateStr: string, count = 6): Player[] {
  const rand = mulberry32(hashString(dateStr));
  const shuffled = shuffle(data.players, rand);

  const picked: Player[] = [];
  const usedClubs = new Set<string>();
  const usedCountries = new Set<string>();

  for (const player of shuffled) {
    if (usedClubs.has(player.club) || usedCountries.has(player.countryCode)) {
      continue;
    }
    picked.push(player);
    usedClubs.add(player.club);
    usedCountries.add(player.countryCode);
    if (picked.length === count) break;
  }

  return picked;
}

/** All countries, sorted by name — used to populate the typeahead. */
export function getCountries(): Country[] {
  return data.countries.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Continent for each custom country code used in the player set. Confederation
 * outliers are placed by geography (Australia → Oceania) so the hint reads
 * intuitively. Covers every distinct countryCode in quiz-data.json.
 */
const CODE_TO_CONTINENT: Record<string, string> = {
  // Europe
  AUT: "Europe", BEL: "Europe", BIH: "Europe", CRO: "Europe", CZE: "Europe",
  ENG: "Europe", ESP: "Europe", FRA: "Europe", GER: "Europe", NED: "Europe",
  NOR: "Europe", POR: "Europe", SCO: "Europe", SUI: "Europe", SWE: "Europe",
  TUR: "Europe",
  // Africa
  ALG: "Africa", CIV: "Africa", COD: "Africa", CPV: "Africa", EGY: "Africa",
  GHA: "Africa", MAR: "Africa", RSA: "Africa", SEN: "Africa", TUN: "Africa",
  // South America
  ARG: "South America", BRA: "South America", COL: "South America",
  ECU: "South America", PAR: "South America", URU: "South America",
  // North America
  CAN: "North America", CUW: "North America", HAI: "North America",
  MEX: "North America", PAN: "North America", USA: "North America",
  // Asia
  IRN: "Asia", IRQ: "Asia", JOR: "Asia", JPN: "Asia", KOR: "Asia",
  KSA: "Asia", QAT: "Asia", UZB: "Asia",
  // Oceania
  AUS: "Oceania", NZL: "Oceania",
};

/** Continent for a country code, or null if unknown. */
export function continentOf(code: string): string | null {
  return CODE_TO_CONTINENT[code] ?? null;
}

/**
 * A curated, deliberately abstract clue about each country — culture, food,
 * landmarks, or history rather than its name. Used by the "Country clue" hint.
 * Footballers are intentionally never named (the player's name is its own hint).
 * Covers every distinct countryCode in quiz-data.json.
 */
const CODE_TO_FACT: Record<string, string> = {
  ALG: "The largest country on its continent by area, mostly desert and rich in natural gas.",
  ARG: "A major beef and soybean exporter where a Welsh-speaking community still survives in the far south.",
  AUS: "The world's leading exporter of iron ore, home to marsupials found almost nowhere else.",
  AUT: "A landlocked alpine republic famed for crystal glassware and a long line of classical composers.",
  BEL: "The birthplace of the saxophone.",
  BIH: "A country once ruled by Ottomans then Habsburgs, with a famous rebuilt bridge at Mostar.",
  BRA: "The world's biggest coffee grower, holding most of the planet's largest rainforest.",
  CAN: "A vast bilingual federation said to hold more lake water than the rest of the world combined.",
  CIV: "The world's largest cocoa producer, with a planned inland capital few can name.",
  COD: "The source of most of the world's cobalt, named after the river along its western edge.",
  COL: "The world's top emerald supplier and a leading coffee exporter, touching two oceans.",
  CPV: "A volcanic island chain off Africa's west coast, home of barefoot-diva morna singing.",
  CRO: "An Adriatic nation of a thousand islands, credited with inventing the necktie.",
  CUW: "A small Dutch-speaking Caribbean island that lent its name to a blue orange liqueur.",
  CZE: "The world's heaviest per-head beer drinkers, and the language that gave us the word “robot.”",
  ECU: "A leading banana exporter where the so-called “Panama” hat is actually woven.",
  EGY: "A nation split by one great river and a shipping canal joining two seas.",
  ENG: "The birthplace of the industrial revolution and the codified modern game of football.",
  ESP: "Europe's largest olive-oil producer, where one basilica has been under construction for over a century.",
  FRA: "The world's most-visited country and its leading wine producer.",
  GER: "Its continent's biggest economy and car exporter, reunified in 1990.",
  GHA: "Once the “Gold Coast,” a major gold and cocoa exporter and the first in its region to win independence.",
  HAI: "The first state founded by a successful slave revolt, sharing its island with a neighbour.",
  IRN: "An oil-rich former empire that leads the world in pistachio and saffron exports.",
  IRQ: "An oil state on the ancient land between two rivers, once called Mesopotamia.",
  JOR: "A desert kingdom that mines potash from the lowest dry point on Earth's surface.",
  JPN: "An earthquake-prone archipelago that became a giant exporter of cars and electronics.",
  KOR: "A peninsula that exports much of the world's semiconductors and smartphones, split from a northern rival.",
  KSA: "The world's largest oil exporter, home to a major faith's two holiest cities.",
  MAR: "A kingdom of walled medinas that supplies much of the world's phosphate.",
  MEX: "The original home of chocolate and chilli peppers, bridging two American continents.",
  NED: "A low country largely reclaimed from the sea, ranked among the world's top food exporters.",
  NOR: "A coastline carved into deep glacial inlets, funded by oil and the world's biggest sovereign wealth fund.",
  NZL: "A remote two-island nation with more sheep than people and an indigenous pre-game war dance.",
  PAN: "An isthmus that grows wealthy on ships passing between two oceans.",
  PAR: "A landlocked country with a co-official indigenous language and enormous hydroelectric dams.",
  POR: "Its continent's westernmost mainland nation and the world's leading producer of cork.",
  QAT: "A tiny, fabulously wealthy desert peninsula floating on natural gas.",
  RSA: "A nation with three capital cities and some of the world's richest gold and platinum reserves.",
  SCO: "A northern land of lochs and tartan, the birthplace of golf.",
  SEN: "Continental Africa's westernmost point, a major exporter of groundnuts (peanuts).",
  SUI: "A neutral, landlocked banking haven with four official languages.",
  SWE: "A long-neutral Nordic nation of flat-pack furniture, where the Nobel Prizes are awarded.",
  TUN: "The smallest nation on its coast of the continent, where the Arab Spring began.",
  TUR: "A country split across two continents and the world's top hazelnut producer.",
  URU: "A small South American nation that was the first to fully legalise cannabis.",
  USA: "The world's largest economy, a federation of fifty states.",
  UZB: "A doubly-landlocked Silk Road nation and a major cotton grower.",
};

/** Curated abstract clue for a country code, or null if none. */
export function factOf(code: string): string | null {
  return CODE_TO_FACT[code] ?? null;
}
