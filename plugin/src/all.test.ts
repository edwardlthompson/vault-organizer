import { describe, expect, it } from "vitest";
import { cosineSimilarity, kMeans, meanVector } from "./math";
import {
  clampDepth,
  extractTitleHint,
  headTail,
  normalizeTag,
  topicFolderLabel,
  extractTopicTerms,
  sharedTopicLabel,
  isJunkTopicFolder,
} from "./text";
import {
  rankFolders,
  rankTags,
  composeTopicFolder,
  proposeTags,
  findSimilarFolder,
  findFolderForTags,
  pickFolderRelevantTags,
  pickPrimaryTag,
} from "./taxonomy";
import { createHashEmbedder } from "./embedder";
import { buildVaultIndex, suggestForNote } from "./sorter";
import { isProcessed, upsertFrontmatter, readExistingTags, isManualPinned, markManualPinned, shouldSkipAutoOrganize } from "./apply";
import { ConcurrentQueue } from "./queue";
import { probeHardware } from "./hardware";
import {
  shouldAutoApply,
  shouldWatchPath,
  isUncategorized,
  isRootNote,
} from "./inbox";
import { DEFAULT_SETTINGS } from "./types";
import {
  extractExternalUrls,
  extractWikiTargets,
  contextFromUrl,
  offlineLinkContext,
  parseHtmlTitle,
  cacheFresh,
  enrichWithLinks,
} from "./links";

describe("math", () => {
  it("cosine of identical vectors is 1", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });

  it("kMeans assigns points", () => {
    const points = [
      [1, 0],
      [0.9, 0.1],
      [0, 1],
      [0.1, 0.9],
    ];
    const { assignments, centroids } = kMeans(points, 2);
    expect(centroids).toHaveLength(2);
    expect(assignments).toHaveLength(4);
  });

  it("meanVector averages", () => {
    expect(meanVector([
      [1, 0],
      [0, 1],
    ])).toEqual([0.5, 0.5]);
  });
});

describe("text", () => {
  it("extracts H1 title", () => {
    expect(extractTitleHint("a.md", "# Hello World\n\nbody")).toBe("Hello World");
  });

  it("normalizes tags", () => {
    expect(normalizeTag("Work")).toBe("#work");
  });

  it("clamps folder depth", () => {
    expect(clampDepth("a/b/c/d/e", 2)).toBe("a/b");
  });

  it("headTail shortens", () => {
    const s = "x".repeat(100);
    expect(headTail(s, 50).length).toBeLessThanOrEqual(60);
  });
});

describe("taxonomy + sorter", () => {
  it("ranks folders by similarity", () => {
    const folders = rankFolders(
      [1, 0],
      [
        { folder: "Work", vector: [1, 0], count: 2 },
        { folder: "Life", vector: [0, 1], count: 1 },
      ],
      { allowNew: true, maxDepth: 3 }
    );
    expect(folders[0].folder).toBe("Work");
  });

  it("suggests using hash embedder", async () => {
    const embed = createHashEmbedder();
    const index = await buildVaultIndex(
      embed,
      [
        {
          path: "Work/a.md",
          folder: "Work",
          content: "Project meeting agenda quarterly planning",
          tags: ["#work"],
        },
        {
          path: "Life/b.md",
          folder: "Life",
          content: "Grocery list milk eggs bread",
          tags: ["#life"],
        },
      ],
      DEFAULT_SETTINGS
    );
    const suggestion = await suggestForNote(
      embed,
      index,
      {
        path: "Inbox/c.md",
        filename: "c.md",
        content: "Project meeting notes for quarterly planning",
      },
      DEFAULT_SETTINGS
    );
    expect(suggestion.folders.length).toBeGreaterThan(0);
    expect(suggestion.titles[0].title.length).toBeGreaterThan(0);
  });

  it("reuses indexed vectors instead of re-embedding", async () => {
    let embedCalls = 0;
    const base = createHashEmbedder();
    const embed = async (texts: string[]) => {
      embedCalls++;
      return base(texts);
    };
    const index = await buildVaultIndex(
      embed,
      [
        {
          path: "Work/a.md",
          folder: "Work",
          content: "alpha project notes",
          tags: [],
        },
      ],
      DEFAULT_SETTINGS
    );
    const callsAfterIndex = embedCalls;
    await suggestForNote(
      embed,
      index,
      { path: "Work/a.md", filename: "a.md", content: "alpha project notes" },
      DEFAULT_SETTINGS
    );
    expect(embedCalls).toBe(callsAfterIndex);
  });

  it("reuses seed vectors when fingerprint matches", async () => {
    let embedCalls = 0;
    const base = createHashEmbedder();
    const embed = async (texts: string[]) => {
      embedCalls++;
      return base(texts);
    };
    const first = await buildVaultIndex(
      embed,
      [
        {
          path: "Work/a.md",
          folder: "Work",
          content: "alpha project notes unchanged",
          tags: [],
        },
      ],
      DEFAULT_SETTINGS
    );
    const callsFirst = embedCalls;
    const seed = new Map(
      [...first.noteVectors.entries()].map(([p, vector]) => [
        p,
        { fp: first.fingerprints.get(p)!, vector },
      ])
    );
    const second = await buildVaultIndex(
      embed,
      [
        {
          path: "Work/a.md",
          folder: "Work",
          content: "alpha project notes unchanged",
          tags: [],
        },
      ],
      DEFAULT_SETTINGS,
      undefined,
      undefined,
      seed
    );
    expect(second.reused).toBe(1);
    expect(second.embedded).toBe(0);
    expect(embedCalls).toBe(callsFirst);
  });

  it("formats clock as m:ss", async () => {
    const { formatClock } = await import("./job");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3723)).toBe("1:02:03");
  });

  it("honours cancel during index build", async () => {
    const embed = createHashEmbedder();
    let checks = 0;
    await expect(
      buildVaultIndex(
        embed,
        Array.from({ length: 6 }, (_, i) => ({
          path: `n${i}.md`,
          folder: "",
          content: `note body ${i} unique words here`,
          tags: [],
        })),
        DEFAULT_SETTINGS,
        undefined,
        () => {
          checks++;
          return checks > 1;
        }
      )
    ).rejects.toThrow(/cancel/i);
  });
});

describe("apply helpers", () => {
  it("detects processed frontmatter", () => {
    const md = "---\nvault-organizer: processed\n---\n\nHi";
    expect(isProcessed(md, "vault-organizer")).toBe(true);
  });

  it("pins manual moves and skips auto-organize", () => {
    const pinned = markManualPinned("# Hello\n\nbody", "vault-organizer");
    expect(isManualPinned(pinned, "vault-organizer")).toBe(true);
    expect(pinned).toContain("vault-organizer: manual");
    expect(pinned).toContain("manual-sort");
    expect(shouldSkipAutoOrganize(pinned, "vault-organizer")).toBe(true);
    expect(
      shouldSkipAutoOrganize(pinned, "vault-organizer", { ignoreProcessed: true })
    ).toBe(true);
    const processed = "---\nvault-organizer: processed\n---\n\nx";
    expect(
      shouldSkipAutoOrganize(processed, "vault-organizer", { ignoreProcessed: true })
    ).toBe(false);
  });

  it("generated folder registry tracks plugin folders only", async () => {
    const { GeneratedFolderRegistry } = await import("./generated-folders");
    const reg = new GeneratedFolderRegistry();
    reg.add("Cryptocurrency");
    expect(reg.isGenerated("Cryptocurrency")).toBe(true);
    expect(reg.isGenerated("My Personal Notes")).toBe(false);
  });

  it("upserts tags without leaving orphan list items", () => {
    const broken = `---
title: Test
created_at: now

  - orphan
  - leftover
tags:
  - oldtag
vault-organizer: processed
---

Body
`;
    const next = upsertFrontmatter(broken, ["#programming", "#android"], "vault-organizer");
    expect(next).toContain("  - programming");
    expect(next).toContain("  - android");
    expect(next).not.toMatch(/\n  - orphan/);
    expect(next).not.toContain("oldtag");
    expect(readExistingTags(next)).toEqual(["#programming", "#android"]);
  });

  it("uniqueDestPath suffixes when destination is taken", async () => {
    const { uniqueDestPath } = await import("./apply");
    const taken = new Set(["Trading/Note.md"]);
    expect(
      uniqueDestPath("Trading", "Note.md", "Inbox/Note.md", (p) => taken.has(p))
    ).toBe("Trading/Note 2.md");
  });

  it("proposes folder and topic tags", () => {
    const tags = proposeTags([1, 0], [], {
      maxTags: 5,
      noteText: "# Android Radio\n\nFord fusion navigation head unit install",
      noteFilename: "android-radio.md",
      folderHint: "Programming",
    });
    expect(tags.some((t) => t.tag === "#programming")).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
  });
});

describe("queue + hardware + inbox", () => {
  it("runs with concurrency", async () => {
    const q = new ConcurrentQueue(2);
    const order: number[] = [];
    await Promise.all([
      q.add(async () => {
        order.push(1);
        return 1;
      }),
      q.add(async () => {
        order.push(2);
        return 2;
      }),
    ]);
    expect(order).toContain(1);
  });

  it("probes hardware", () => {
    const h = probeHardware({ batchMode: "manual", manualBatchSize: 3 });
    expect(h.batchSize).toBe(3);
  });

  it("inbox watch rules", () => {
    expect(shouldWatchPath("Inbox/a.md", DEFAULT_SETTINGS)).toBe(true);
    expect(shouldAutoApply("Inbox/a.md", { ...DEFAULT_SETTINGS, applyMode: "auto-inbox" })).toBe(
      true
    );
  });

  it("treats vault-root notes as uncategorized", () => {
    expect(isRootNote("Loose note.md")).toBe(true);
    expect(isRootNote("Work/a.md")).toBe(false);
    expect(isUncategorized("Loose note.md", DEFAULT_SETTINGS)).toBe(true);
    expect(isUncategorized("Inbox/x.md", DEFAULT_SETTINGS)).toBe(true);
    expect(isUncategorized("Work/a.md", DEFAULT_SETTINGS)).toBe(false);
  });
});

describe("topic folder naming", () => {
  it("extracts topic terms and labels", () => {
    const terms = extractTopicTerms(
      "# Quarterly Planning\n\nProject meeting agenda for quarterly planning roadmap"
    );
    expect(terms.length).toBeGreaterThan(0);
    expect(topicFolderLabel(terms)).toMatch(/[A-Z]/);
  });

  it("ignores URL noise in topic terms", () => {
    const terms = extractTopicTerms(
      "https://www.example.com/bitcoin-wallet\n\nCold storage hardware wallet seed phrase"
    );
    expect(terms).not.toContain("https");
    expect(terms).not.toContain("www");
    expect(terms).not.toContain("com");
    expect(terms.some((t) => /bitcoin|wallet|hardware|seed|storage/.test(t))).toBe(true);
    expect(isJunkTopicFolder("Https Com")).toBe(true);
    expect(isJunkTopicFolder("Https Com Bitcoin")).toBe(true);
    expect(isJunkTopicFolder("Bitcoin Wallets")).toBe(false);
  });

  it("proposes a new topic folder when match is weak", () => {
    const folders = rankFolders(
      [0, 1],
      [{ folder: "Work", vector: [1, 0], count: 5 }],
      {
        allowNew: true,
        maxDepth: 3,
        newFolderThreshold: 0.9,
        noteText: "# Garden Design\n\nRaised beds compost soil tomatoes herbs",
        noteFilename: "garden.md",
        topicFolderPrefix: "Topics",
      }
    );
    expect(folders[0].isNewFolder).toBe(true);
    expect(folders[0].folder.startsWith("Topics/")).toBe(true);
  });

  it("skips junk folders when ranking", () => {
    const folders = rankFolders(
      [1, 0],
      [
        { folder: "Https Com", vector: [1, 0], count: 50 },
        { folder: "Programming", vector: [0.9, 0.1], count: 5 },
      ],
      { allowNew: false, maxDepth: 3 }
    );
    expect(folders.every((f) => f.folder !== "Https Com")).toBe(true);
    expect(folders[0]?.folder).toBe("Programming");
  });

  it("boosts folders that match tag hints", () => {
    const folders = rankFolders(
      [0, 1],
      [
        { folder: "Passwords", vector: [1, 0], count: 100 },
        { folder: "Trading", vector: [0.2, 0.8], count: 5 },
      ],
      { allowNew: false, maxDepth: 3, tagHints: ["#trading", "#altcoin"] }
    );
    expect(folders[0]?.folder).toBe("Trading");
  });

  it("creates tag-based folder when embedding top ignores tags", () => {
    const folders = rankFolders(
      [1, 0],
      [
        { folder: "I Heart PR Tours", vector: [1, 0], count: 200 },
        { folder: "Trading", vector: [0, 1], count: 5 },
      ],
      {
        allowNew: true,
        maxDepth: 3,
        newFolderThreshold: 0.99,
        tagHints: ["#bitcoin", "#wallet"],
        noteText: "bitcoin wallet cold storage",
        noteFilename: "btc.md",
        useThemeCatalog: false,
      }
    );
    // Primary tag only — not a multi-tag mashup like "Bitcoin Wallet".
    expect(folders[0]?.folder.toLowerCase()).toBe("bitcoin");
  });

  it("theme catalog maps bitcoin/crypto to Cryptocurrency", async () => {
    const { ThemeCatalog } = await import("./themes");
    const cat = new ThemeCatalog();
    expect(cat.canonicalizeTheme("bitcoin")).toBe("Cryptocurrency");
    expect(cat.canonicalizeTheme("altcoin")).toBe("Cryptocurrency");
    expect(cat.themeFolderForHints(["#wallet", "#android"])).toBe("Cryptocurrency");
    expect(cat.remapFolderLeaf("Card Best Bitcoin")).toBe("Cryptocurrency");
    expect(cat.canonicalizeTheme("android")).toBe("Android");
  });

  it("rankFolders forces Cryptocurrency from theme catalog", async () => {
    const { ThemeCatalog } = await import("./themes");
    const cat = new ThemeCatalog();
    const folders = rankFolders(
      [1, 0],
      [
        { folder: "I Heart PR Tours", vector: [1, 0], count: 200 },
        { folder: "Card Best Bitcoin", vector: [0.5, 0.5], count: 10 },
      ],
      {
        allowNew: true,
        maxDepth: 3,
        tagHints: ["#bitcoin", "#wallet"],
        themeCatalog: cat,
        useThemeCatalog: true,
      }
    );
    expect(folders[0]?.folder).toBe("Cryptocurrency");
    expect(folders[0]?.folder.toLowerCase()).not.toMatch(/card|best/);
  });

  it("nameTheme uses catalog before wikipedia", async () => {
    const { ThemeCatalog } = await import("./themes");
    const { nameTheme } = await import("./theme-namer");
    const cat = new ThemeCatalog();
    let requested = false;
    const result = await nameTheme(
      {
        hints: ["bitcoin", "cold storage"],
        existingThemes: cat.listCanonicalThemes(),
        catalog: cat,
      },
      {
        online: true,
        request: async () => {
          requested = true;
          return { status: 500 };
        },
      }
    );
    expect(result.theme).toBe("Cryptocurrency");
    expect(result.source).toBe("catalog");
    expect(requested).toBe(false);
  });

  it("nameTheme prefers existing theme from wikipedia fixture", async () => {
    const { ThemeCatalog } = await import("./themes");
    const { nameTheme } = await import("./theme-namer");
    const cat = new ThemeCatalog();
    const result = await nameTheme(
      {
        hints: ["obscure-widget-xyz"],
        existingThemes: cat.listCanonicalThemes(),
        catalog: cat,
      },
      {
        online: true,
        request: async (url) => {
          if (url.includes("search/title")) {
            return {
              status: 200,
              json: { pages: [{ title: "Android (operating system)" }] },
            };
          }
          if (url.includes("page/summary")) {
            return {
              status: 200,
              json: {
                title: "Android (operating system)",
                description: "Mobile operating system",
                extract: "Android is a mobile OS",
              },
            };
          }
          if (url.includes("categories")) {
            return {
              status: 200,
              json: {
                query: {
                  pages: {
                    "1": {
                      categories: [{ title: "Category:Android (operating system)" }],
                    },
                  },
                },
              },
            };
          }
          return { status: 404 };
        },
      }
    );
    expect(result.theme).toBe("Android");
    expect(result.isNew).toBe(false);
  });

  it("blends tags into an existing similar folder", () => {
    const folders = rankFolders(
      [0, 1],
      [
        { folder: "Bitcoin", vector: [0.1, 0.9], count: 12 },
        { folder: "Recipes", vector: [1, 0], count: 3 },
      ],
      {
        allowNew: true,
        maxDepth: 3,
        tagHints: ["#bitcoin", "#cold-wallet"],
        noteText: "hardware wallet seed",
        noteFilename: "seed.md",
      }
    );
    expect(folders[0]?.folder).toBe("Bitcoin");
    expect(folders[0]?.isNewFolder).toBe(false);
  });

  it("findSimilarFolder prefers broader existing names", () => {
    const hit = findSimilarFolder("Bitcoin Wallet", [
      { folder: "Bitcoin", vector: [1, 0], count: 10 },
      { folder: "Recipes", vector: [0, 1], count: 2 },
    ]);
    expect(hit?.folder).toBe("Bitcoin");
  });

  it("pickFolderRelevantTags prefers vault-common / folder-aligned tags", () => {
    const picked = pickFolderRelevantTags(
      ["#obscure-unique-phrase", "#trading", "#xyz"],
      [{ folder: "Trading", vector: [1, 0], count: 5 }],
      [{ tag: "#trading", vector: [1, 0] }],
      2
    );
    expect(picked[0]).toBe("trading");
  });

  it("findFolderForTags maps shared tags to folders", () => {
    const home = findFolderForTags(["#passwords", "#login"], [
      { folder: "Passwords", vector: [1, 0], count: 40 },
      { folder: "Work", vector: [0, 1], count: 2 },
    ]);
    expect(home?.folder).toBe("Passwords");
  });

  it("pickPrimaryTag prefers tags that already name a folder", () => {
    expect(
      pickPrimaryTag(["#wallet", "#bitcoin"], [
        { folder: "Bitcoin", vector: [1, 0], count: 5 },
      ])
    ).toBe("bitcoin");
  });

  it("names clusters from shared terms", () => {
    const label = sharedTopicLabel([
      "garden soil compost tomatoes",
      "garden raised beds compost",
      "tomato garden soil",
    ]);
    expect(label.toLowerCase()).toMatch(/garden|soil|compost|tomato/);
  });

  it("composeTopicFolder clamps depth", () => {
    expect(composeTopicFolder("a b c d e", "Topics", 2).split("/").length).toBeLessThanOrEqual(2);
  });
});

describe("links", () => {
  it("extracts markdown and bare URLs", () => {
    const md =
      "See [doc](https://example.com/bitcoin-wallet) and https://other.org/path/cold-storage.";
    expect(extractExternalUrls(md)).toEqual(
      expect.arrayContaining([
        "https://example.com/bitcoin-wallet",
        "https://other.org/path/cold-storage",
      ])
    );
  });

  it("extracts wiki targets", () => {
    expect(extractWikiTargets("See [[Cold Wallet]] and [[Trading|trades]]")).toEqual(
      expect.arrayContaining(["Cold Wallet", "Trading"])
    );
  });

  it("builds offline context from URL path", () => {
    const ctx = contextFromUrl("https://www.example.com/bitcoin-cold-wallet/guide");
    expect(ctx).toMatch(/bitcoin/);
    expect(ctx).toMatch(/cold/);
    expect(ctx).toMatch(/wallet/);
    expect(ctx).not.toMatch(/\bcom\b/);
  });

  it("aggregates offline link context", () => {
    const text = offlineLinkContext(
      "https://site.com/android-radio-install\n[[Other]]"
    );
    expect(text).toMatch(/android/);
    expect(text).toMatch(/radio/);
  });

  it("parses html titles", () => {
    expect(parseHtmlTitle("<html><title>Hello World</title></html>")).toBe("Hello World");
    expect(
      parseHtmlTitle('<meta property="og:title" content="OG Title" />')
    ).toBe("OG Title");
  });

  it("cache freshness respects TTL", () => {
    expect(cacheFresh({ ts: Date.now(), ok: true })).toBe(true);
    expect(cacheFresh({ ts: Date.now() - 8 * 24 * 60 * 60 * 1000, ok: true })).toBe(
      false
    );
  });

  it("enrichWithLinks resolves wiki without network when checkDead", async () => {
    const result = await enrichWithLinks("See [[Missing Note]] and [[Present]]", {
      checkDead: true,
      fetchTitles: false,
      resolveWiki: (t) => t === "Present",
    });
    expect(result.deadLinks.some((d) => d.url === "[[Missing Note]]")).toBe(true);
    expect(result.liveLinks.some((d) => d.url === "[[Present]]")).toBe(true);
  });

  it("writes dead links into frontmatter", () => {
    const next = upsertFrontmatter(
      "Body only",
      ["#topic"],
      "vault-organizer",
      { deadLinks: ["https://dead.example/x"], markProcessed: false }
    );
    expect(next).toContain("vault-organizer-dead-links:");
    expect(next).toContain("https://dead.example/x");
    expect(next).not.toContain("vault-organizer: processed");
    expect(next).toContain("  - topic");
  });
});
