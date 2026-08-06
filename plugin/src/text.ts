export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

export function extractTitleHint(filename: string, content: string): string {
  const body = stripFrontmatter(content);
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return sanitizeTitle(h1[1]);
  const firstLine = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("!["));
  if (firstLine && firstLine.length <= 80) return sanitizeTitle(firstLine);
  return sanitizeTitle(filename.replace(/\.md$/i, "").replace(/[-_]/g, " "));
}

export function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[#*[\]\\/<>:"|?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function headTail(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  const ellipsis = "\n\n…\n\n";
  const budget = Math.max(16, maxChars - ellipsis.length);
  const head = Math.floor(budget * 0.7);
  const tail = budget - head;
  return `${text.slice(0, head)}${ellipsis}${text.slice(-tail)}`;
}

export function slugFolderSegment(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

export function normalizeTag(tag: string): string {
  let t = tag.trim();
  if (!t.startsWith("#")) t = `#${t}`;
  return t.replace(/\s+/g, "-").toLowerCase();
}

export function clampDepth(folder: string, maxDepth: number): string {
  const parts = folder.split("/").filter(Boolean).map(slugFolderSegment).filter(Boolean);
  return parts.slice(0, Math.max(1, maxDepth)).join("/");
}

const STOPWORDS = new Set(
  `
a an the and or but if then else when at by for with about against between into through
during before after above below to from up down in out on off over under again further
once here there all any both each few more most other some such no nor not only own same
so than too very can will just don should now also into onto of is are was were be been
being have has had do does did doing would could this that these those it its i me my we
our you your he she they them his her their what which who whom as
`.trim().split(/\s+/)
);

/** URL / web-clipping tokens that produced folders like "Https Com". */
const TOPIC_NOISE = new Set(
  `
http https www com org net edu gov io co uk us ca html htm php asp aspx
cgi jpg jpeg png gif svg webp pdf doc docx mp4 mov avi
amp utm src ref share click track redirect index page home
watch youtube google facebook twitter instagram linkedin reddit
t02 mailto ftp file localhost
`.trim().split(/\s+/)
);

/** Strip URLs and tracking junk before topic extraction. */
export function scrubTopicText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/[?&#]utm_[^=\s]+=\S+/gi, " ")
    .replace(/\b[a-z0-9-]+\.(com|org|net|io|edu|gov|co)\b/gi, " ");
}

function isTopicNoise(token: string): boolean {
  if (STOPWORDS.has(token) || TOPIC_NOISE.has(token)) return true;
  if (/^\d+$/.test(token)) return true;
  if (token.length <= 2) return true;
  if (/^[a-f0-9]{8,}$/i.test(token)) return true;
  return false;
}

/** True when a folder name is dominated by URL/web-clipping noise. */
export function isJunkTopicFolder(folder: string): boolean {
  const parts = folder
    .toLowerCase()
    .split(/[/\s_-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return true;
  // Leading URL tokens always count as junk ("Com Cryptocompare…", "Https Com").
  if (TOPIC_NOISE.has(parts[0])) return true;
  const junk = parts.filter((p) => TOPIC_NOISE.has(p) || STOPWORDS.has(p)).length;
  if (parts.some((p) => p === "http" || p === "https" || p === "www")) return true;
  return junk >= Math.max(1, Math.ceil(parts.length * 0.5));
}

/** Pull topical tokens from note text for generative folder naming (no LLM). */
export function extractTopicTerms(text: string, limit = 8): string[] {
  const body = scrubTopicText(stripFrontmatter(text)).toLowerCase();
  const counts = new Map<string, number>();
  for (const raw of body.match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (isTopicNoise(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const heading = body.match(/^#\s+(.+)$/m)?.[1] ?? "";
  for (const raw of heading.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (isTopicNoise(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 3);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

/** Build a readable folder label from topic terms, e.g. "Project Planning". */
export function topicFolderLabel(terms: string[], maxWords = 3): string {
  const words = terms
    .filter((w) => !isTopicNoise(w.toLowerCase()))
    .slice(0, maxWords)
    .map((w) => w.replace(/-/g, " "))
    .flatMap((w) => w.split(/\s+/))
    .filter((w) => w && !isTopicNoise(w.toLowerCase()))
    .slice(0, maxWords)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const label = slugFolderSegment(words.join(" "));
  return label || "Notes";
}

/** Shared keywords across a cluster of texts for naming. */
export function sharedTopicLabel(texts: string[], maxWords = 3): string {
  const docFreq = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set(extractTopicTerms(t, 12));
    for (const term of seen) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }
  const ranked = [...docFreq.entries()]
    .filter(([, n]) => n >= Math.max(1, Math.ceil(texts.length * 0.25)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([w]) => w);
  return topicFolderLabel(ranked.length ? ranked : extractTopicTerms(texts[0] ?? "", 5), maxWords);
}
