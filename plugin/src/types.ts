export interface FolderSuggestion {
  folder: string;
  score: number;
  isNewFolder: boolean;
  reason: string;
}

export interface TagSuggestion {
  tag: string;
  score: number;
  isNew: boolean;
  reason: string;
}

export interface TitleSuggestion {
  title: string;
  score: number;
  reason: string;
}

export interface OrganizeSuggestion {
  path: string;
  summary: string;
  folders: FolderSuggestion[];
  tags: TagSuggestion[];
  titles: TitleSuggestion[];
  confidence: number;
  /** Dead external/wiki links discovered while organizing. */
  deadLinks?: string[];
}

export interface VaultOrganizerSettings {
  inboxFolder: string;
  excludedFolders: string[];
  maxTags: number;
  maxFolderDepth: number;
  confidenceThreshold: number;
  /** Below this similarity to existing folders, propose a new topic folder. */
  newFolderThreshold: number;
  /** Optional prefix for generative folders, e.g. "Topics". Empty = vault root. */
  topicFolderPrefix: string;
  /** Include vault-root notes in Organize uncategorized. */
  organizeRootNotes: boolean;
  /** Include Inbox notes in Organize uncategorized. */
  organizeInboxAsUncategorized: boolean;
  batchMode: "auto" | "manual";
  manualBatchSize: number;
  applyMode: "suggest" | "auto-inbox" | "auto-all";
  allowNewFolders: boolean;
  processedFrontmatterKey: string;
  settleDelayMs: number;
  modelPackId: "arctic-embed-m" | "arctic-embed-s" | "arctic-embed-l";
  /** Use URLs in notes (path tokens + optional page titles) for categorization. */
  useLinkContext: boolean;
  /** Probe external + wiki links and record dead ones on apply. */
  checkDeadLinks: boolean;
  /** Max links to probe per note. */
  maxLinksPerNote: number;
  /** Map synonyms → canonical theme folders (Bitcoin → Cryptocurrency). */
  useThemeCatalog: boolean;
  /** When catalog misses, look up Wikipedia/Wikidata (no API key). */
  onlineThemeNaming: boolean;
}

export const DEFAULT_SETTINGS: VaultOrganizerSettings = {
  inboxFolder: "Inbox",
  excludedFolders: [".obsidian", "_VaultOrganizer"],
  maxTags: 5,
  maxFolderDepth: 4,
  confidenceThreshold: 0.35,
  newFolderThreshold: 0.28,
  topicFolderPrefix: "",
  organizeRootNotes: true,
  organizeInboxAsUncategorized: true,
  batchMode: "auto",
  manualBatchSize: 4,
  applyMode: "suggest",
  allowNewFolders: true,
  processedFrontmatterKey: "vault-organizer",
  settleDelayMs: 1500,
  modelPackId: "arctic-embed-m",
  useLinkContext: true,
  checkDeadLinks: true,
  maxLinksPerNote: 5,
  useThemeCatalog: true,
  onlineThemeNaming: true,
};

export interface HardwareProfile {
  cores: number;
  deviceMemoryGb: number | null;
  webgpu: boolean;
  batchSize: number;
  label: string;
}

export interface UndoRecord {
  id: string;
  timestamp: number;
  fromPath: string;
  toPath: string;
  addedTags: string[];
  previousTags: string[];
}
