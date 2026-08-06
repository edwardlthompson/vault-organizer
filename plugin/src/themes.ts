import { topicFolderLabel } from "./text";

/** User/vault theme overrides: synonym (lowercase) → canonical folder name. */
export type ThemeMap = Record<string, string>;

export interface ThemesFile {
  /** synonym → Canonical Folder */
  themes?: ThemeMap;
}

function normSyn(s: string): string {
  return s
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Built-in synonym → canonical folder map.
 * Keep synonyms single/short tokens where possible; multi-word keys are ok.
 */
export const BUILTIN_THEMES: ThemeMap = {
  // Cryptocurrency
  bitcoin: "Cryptocurrency",
  btc: "Cryptocurrency",
  crypto: "Cryptocurrency",
  cryptocurrency: "Cryptocurrency",
  cryptocurrencies: "Cryptocurrency",
  altcoin: "Cryptocurrency",
  altcoins: "Cryptocurrency",
  ethereum: "Cryptocurrency",
  eth: "Cryptocurrency",
  defi: "Cryptocurrency",
  wallet: "Cryptocurrency",
  wallets: "Cryptocurrency",
  blockchain: "Cryptocurrency",
  noncustodial: "Cryptocurrency",
  custodial: "Cryptocurrency",
  exchange: "Cryptocurrency",
  exchanges: "Cryptocurrency",
  coinbase: "Cryptocurrency",
  binance: "Cryptocurrency",
  ledger: "Cryptocurrency",
  trezor: "Cryptocurrency",
  seed: "Cryptocurrency",
  mnemonic: "Cryptocurrency",
  metamask: "Cryptocurrency",
  uniswap: "Cryptocurrency",
  solana: "Cryptocurrency",
  // Trading (broader markets; crypto still wins via more specific synonyms)
  trading: "Trading",
  stocks: "Trading",
  options: "Trading",
  forex: "Trading",
  // Android / mobile
  android: "Android",
  codelab: "Android",
  codelabs: "Android",
  aosp: "Android",
  // Passwords / security credentials
  password: "Passwords",
  passwords: "Passwords",
  login: "Passwords",
  credentials: "Passwords",
  // Cars / auto
  car: "Cars",
  cars: "Cars",
  auto: "Cars",
  automotive: "Cars",
  ford: "Cars",
  mustang: "Cars",
  dealership: "Cars",
  vehicle: "Cars",
  vehicles: "Cars",
  differential: "Cars",
  fuel: "Cars",
  drift: "Cars",
  drifting: "Cars",
  // Real estate
  "real estate": "Real Estate",
  mortgage: "Real Estate",
  realtor: "Real Estate",
  housing: "Real Estate",
  // Homeschool / education
  homeschool: "Homeschool",
  school: "Homeschool",
  education: "Homeschool",
  children: "Homeschool",
  // Privacy
  privacy: "Privacy",
  tracking: "Privacy",
  vpn: "Privacy",
  // Programming / tech
  programming: "Programming",
  coding: "Programming",
  developer: "Programming",
  software: "Programming",
  api: "Programming",
  // Linux
  linux: "Linux",
  grub: "Linux",
  ubuntu: "Linux",
  debian: "Linux",
  kernel: "Linux",
  // Photography / cameras
  photography: "Photography",
  camera: "Photography",
  cameras: "Photography",
  sony: "Photography",
  olympus: "Photography",
  ricoh: "Photography",
  // Dating
  dating: "Dating",
  tinder: "Dating",
  // Jobs
  job: "Jobs",
  jobs: "Jobs",
  career: "Jobs",
  resume: "Jobs",
  // Tourism / travel
  tourism: "Tourism",
  travel: "Tourism",
  vacation: "Tourism",
  // Family
  family: "Family",
  // Tech catch-all
  tech: "Tech",
  technology: "Tech",
  // Audio
  audio: "Audio",
  music: "Audio",
  // Solar / energy
  solar: "Energy",
  battery: "Energy",
  voltage: "Energy",
  // Gaming
  gaming: "Gaming",
  game: "Gaming",
  // Work / projects
  project: "Projects",
  kickoff: "Projects",
  client: "Projects",
  // Payments / fintech (non-crypto)
  payments: "Finance",
  payment: "Finance",
  credit: "Finance",
  debit: "Finance",
  bank: "Finance",
  zelle: "Finance",
  venmo: "Finance",
  paypal: "Finance",
  // PR / tours (large existing bucket — keep as theme)
  tour: "Tours",
  tours: "Tours",
  // Misc bootstrap
  misc: "Misc",
  notes: "Misc",
};

export class ThemeCatalog {
  private map: ThemeMap;

  constructor(overrides?: ThemeMap) {
    this.map = { ...BUILTIN_THEMES };
    if (overrides) this.merge(overrides);
  }

  merge(overrides: ThemeMap): void {
    for (const [k, v] of Object.entries(overrides)) {
      const key = normSyn(k);
      const val = (v || "").trim();
      if (!key || !val) continue;
      this.map[key] = val;
    }
  }

  /** Load from parsed themes.json object. */
  static fromFile(data: ThemesFile | ThemeMap | null | undefined): ThemeCatalog {
    const cat = new ThemeCatalog();
    if (!data || typeof data !== "object") return cat;
    const asFile = data as ThemesFile;
    if (asFile.themes && typeof asFile.themes === "object" && !Array.isArray(asFile.themes)) {
      cat.merge(asFile.themes);
      return cat;
    }
    cat.merge(data as ThemeMap);
    return cat;
  }

  /** Serialize learned/user map (only non-builtin or overridden values). */
  toFile(includeBuiltin = false): ThemesFile {
    if (includeBuiltin) return { themes: { ...this.map } };
    const themes: ThemeMap = {};
    for (const [k, v] of Object.entries(this.map)) {
      if (BUILTIN_THEMES[k] === v) continue;
      themes[k] = v;
    }
    return { themes };
  }

  /** Full map including builtins (for persistence of learned synonyms alongside). */
  allEntries(): ThemeMap {
    return { ...this.map };
  }

  canonicalizeTheme(token: string): string | null {
    const key = normSyn(token);
    if (!key) return null;
    if (this.map[key]) return this.map[key];
    // Try each meaningful token in a multi-word phrase.
    const parts = key.split(/\s+/).filter((p) => p.length >= 3);
    for (const p of parts) {
      if (this.map[p]) return this.map[p];
    }
    return null;
  }

  themeFolderForHints(hints: string[]): string | null {
    const scores = new Map<string, number>();
    for (const h of hints) {
      const theme = this.canonicalizeTheme(h);
      if (!theme) continue;
      scores.set(theme, (scores.get(theme) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [theme, n] of scores) {
      if (n > bestN) {
        best = theme;
        bestN = n;
      }
    }
    return best;
  }

  /**
   * Remap a folder path leaf through the catalog.
   * "Card Best Bitcoin" → "Cryptocurrency" when any token maps.
   */
  remapFolderLeaf(folder: string): string {
    const parts = folder.split("/").filter(Boolean);
    if (parts.length === 0) return folder;
    const leaf = parts[parts.length - 1];
    const theme = this.canonicalizeTheme(leaf);
    if (!theme) return folder;
    parts[parts.length - 1] = theme;
    return parts.join("/");
  }

  listCanonicalThemes(): string[] {
    return [...new Set(Object.values(this.map))].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  /** Stable built-in destination folders only (ignores learned one-off names). */
  listBuiltinThemes(): string[] {
    return [...new Set(Object.values(BUILTIN_THEMES))].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  /** True if folder leaf is one of the built-in canonical themes. */
  isBuiltinTheme(folder: string): boolean {
    const leaf = (folder.split("/").pop() || "").trim().toLowerCase();
    return this.listBuiltinThemes().some((t) => t.toLowerCase() === leaf);
  }

  /** Learn synonym → theme (in-memory). Only allow built-in theme destinations. */
  learn(synonym: string, theme: string): void {
    const key = normSyn(synonym);
    const val = theme.trim();
    if (!key || !val) return;
    const builtins = new Set(
      Object.values(BUILTIN_THEMES).map((t) => t.toLowerCase())
    );
    if (!builtins.has(val.toLowerCase())) return;
    this.map[key] = val;
  }

  /** Short Title-Case folder label from free text (max 2 words). */
  static shortFolderLabel(raw: string): string {
    const cleaned = raw
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[^\w\s-]/g, " ")
      .trim();
    return topicFolderLabel(
      cleaned.split(/\s+/).map((w) => w.toLowerCase()),
      2
    );
  }
}

/** Match a free label against existing canonical themes by token overlap. */
export function matchExistingTheme(
  label: string,
  existingThemes: string[],
  catalog?: ThemeCatalog
): string | null {
  if (catalog) {
    const hit = catalog.canonicalizeTheme(label);
    if (hit) return hit;
  }
  const want = normSyn(label);
  const wantTokens = new Set(want.split(/\s+/).filter((t) => t.length >= 3));
  let best: { theme: string; score: number } | undefined;
  for (const theme of existingThemes) {
    const t = normSyn(theme);
    if (t === want) return theme;
    if (t.includes(want) || want.includes(t)) {
      if (Math.min(t.length, want.length) >= 4) {
        const score = 100 - t.length;
        if (!best || score > best.score) best = { theme, score };
      }
    }
    const tt = t.split(/\s+/).filter((x) => x.length >= 3);
    const inter = tt.filter((x) => wantTokens.has(x)).length;
    if (inter > 0) {
      const score = inter * 10;
      if (!best || score > best.score) best = { theme, score };
    }
  }
  return best && best.score >= 10 ? best.theme : null;
}
