// Dynamic language loader for frontend
// Loads configs at build time with Vite glob, starters fetched from server at runtime
// Optimized for high-traffic with caching and batch loading

import type { KeywordEntry, LanguageConfig, LoadedLanguage, ResolvedKeywordEntry, VersionConfig } from "./types";
import { LANGUAGE_ICONS } from "./types";

// Import all config.json files at build time
const configModules = import.meta.glob<{ default: LanguageConfig }>(
  "/languages/*/config.json",
  { eager: true }
);

// Import all keywords.json files at build time (optional per language)
const keywordModules = import.meta.glob<{ default: Record<string, KeywordEntry> }>(
  "/languages/*/keywords.json",
  { eager: true }
);

// Import all keywords_he.json files at build time (optional per language -
// languages without a Hebrew translation file yet simply have no entries here)
const keywordHeModules = import.meta.glob<{ default: Record<string, KeywordEntry> }>(
  "/languages/*/keywords_he.json",
  { eager: true }
);

// Extract the language id from a glob path like "/languages/python/keywords.json"
function languageIdFromPath(path: string): string {
  const match = path.match(/\/languages\/([^/]+)\//);
  return match ? match[1] : "";
}

const BUILTIN_LANGUAGES: LoadedLanguage[] = [
  {
    id: 'html',
    name: 'HTML',
    extension: 'html',
    monacoLanguage: 'html',
    icon: LANGUAGE_ICONS.html || '🌐',
    versions: [{ id: 'html5', name: 'HTML5', default: true }],
    runner: { command: 'preview' },
    starters: {},
    keywords: {},
    keywordsHe: {},
  },
  {
    id: 'css',
    name: 'CSS',
    extension: 'css',
    monacoLanguage: 'css',
    icon: LANGUAGE_ICONS.css || '🎨',
    versions: [{ id: 'css3', name: 'CSS3', default: true }],
    runner: { command: 'preview' },
    starters: {},
    keywords: {},
    keywordsHe: {},
  },
];

const BUILTIN_STARTERS: Record<string, string> = {
  'html/html5': `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Website</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <main>
    <h1>Hello, world!</h1>
    <p>Edit this page, then click Open Preview.</p>
  </main>
  <script src="./script.js"></script>
</body>
</html>
`,
  'css/css3': `:root {
  font-family: system-ui, sans-serif;
  color: #1f2937;
  background: #f8fafc;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
}
`,
};

// Cache for loaded starters with TTL
interface CacheEntry {
  code: string;
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const starterCache = new Map<string, CacheEntry>();

// Request deduplication - prevents multiple simultaneous requests for same resource
const pendingRequests = new Map<string, Promise<string>>();

// Parse and organize the loaded data
function loadLanguages(): Map<string, LoadedLanguage> {
  const languages = new Map<string, LoadedLanguage>();

  for (const [path, module] of Object.entries(configModules)) {
    const config = module.default;
    languages.set(config.id, {
      ...config,
      icon: config.icon || LANGUAGE_ICONS[config.id] || '📄',
      starters: {},
      keywords: {},
      keywordsHe: {},
    });
  }

  // Attach keyword dictionaries, keyed by the same language id used for config.json
  for (const [path, module] of Object.entries(keywordModules)) {
    const langId = languageIdFromPath(path);
    const lang = languages.get(langId);
    if (lang) {
      lang.keywords = module.default || {};
    }
  }

  // Attach optional Hebrew keyword translations (safe no-op for languages
  // that don't have a keywords_he.json file yet)
  for (const [path, module] of Object.entries(keywordHeModules)) {
    const langId = languageIdFromPath(path);
    const lang = languages.get(langId);
    if (lang) {
      lang.keywordsHe = module.default || {};
    }
  }

  for (const language of BUILTIN_LANGUAGES) {
    if (!languages.has(language.id)) languages.set(language.id, language);
  }

  return languages;
}

// Export loaded languages
export const languages = loadLanguages();

// Helper functions
export function getLanguage(id: string): LoadedLanguage | undefined {
  return languages.get(id);
}

export function getAllLanguages(): LoadedLanguage[] {
  return Array.from(languages.values());
}

export function getLanguageIds(): string[] {
  return Array.from(languages.keys());
}

// Check if cache entry is valid
function isCacheValid(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

// Fetch starter code from server with deduplication
async function fetchStarter(langId: string, versionId: string, extension: string): Promise<string> {
  const cacheKey = `${langId}/${versionId}`;
  const builtInStarter = BUILTIN_STARTERS[cacheKey];
  if (builtInStarter !== undefined) {
    starterCache.set(cacheKey, { code: builtInStarter, timestamp: Date.now() });
    return builtInStarter;
  }
  
  // Check cache first
  const cached = starterCache.get(cacheKey);
  if (isCacheValid(cached)) {
    return cached!.code;
  }
  
  // Check for pending request (deduplication)
  const pending = pendingRequests.get(cacheKey);
  if (pending) {
    return pending;
  }
  
  // Create new request
  const request = (async () => {
    try {
      // Try optimized API endpoint first (returns JSON)
      let resp = await fetch(`/api/starter/${langId}/${versionId}`);
      
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp.json();
          const code = data.code || `// ${langId}\n// Start coding here...\n`;
          starterCache.set(cacheKey, { code, timestamp: Date.now() });
          return code;
        } else {
          // Plain text response (fallback)
          const code = await resp.text();
          starterCache.set(cacheKey, { code, timestamp: Date.now() });
          return code;
        }
      }
      
      // Fallback to static file (plain text)
      resp = await fetch(`/languages/${langId}/starters/${versionId}.${extension}`);
      
      if (resp.ok) {
        const code = await resp.text();
        starterCache.set(cacheKey, { code, timestamp: Date.now() });
        return code;
      }
    } catch (e) {
      console.warn(`Failed to fetch starter for ${langId}/${versionId}:`, e);
    }
    
    return `// ${langId}\n// Start coding here...\n`;
  })();
  
  // Store pending request for deduplication
  pendingRequests.set(cacheKey, request);
  
  try {
    return await request;
  } finally {
    pendingRequests.delete(cacheKey);
  }
}

// Synchronous version - returns cached or placeholder
export function getStarter(langId: string, versionId: string): string {
  const cacheKey = `${langId}/${versionId}`;
  const cached = starterCache.get(cacheKey);
  
  if (isCacheValid(cached)) {
    return cached!.code;
  }
  
  return `// Loading ${langId} (${versionId})...\n`;
}

// Async version that loads from server
export async function getStarterAsync(langId: string, versionId: string): Promise<string> {
  const lang = languages.get(langId);
  if (!lang) return `// Unknown language: ${langId}`;
  
  return fetchStarter(langId, versionId, lang.extension);
}

// Preload starters for a language (batch loading)
export async function preloadStarters(langId: string): Promise<void> {
  const lang = languages.get(langId);
  if (!lang) return;
  
  // Load all versions in parallel
  await Promise.all(
    lang.versions.map(v => fetchStarter(langId, v.id, lang.extension))
  );
}

// Preload default starter for each language (minimal initial load)
export async function preloadDefaultStarters(): Promise<void> {
  const promises = Array.from(languages.values()).map(lang => {
    const defaultVersion = lang.versions.find(v => v.default) || lang.versions[0];
    if (defaultVersion) {
      return fetchStarter(lang.id, defaultVersion.id, lang.extension);
    }
    return Promise.resolve();
  });
  await Promise.all(promises);
}

// Preload all starters (full preload)
export async function preloadAllStarters(): Promise<void> {
  const promises = Array.from(languages.keys()).map(preloadStarters);
  await Promise.all(promises);
}

// Get cache statistics
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: starterCache.size,
    entries: Array.from(starterCache.keys()),
  };
}

export function getDefaultVersion(langId: string): string {
  const lang = languages.get(langId);
  if (!lang) return "";
  const defaultVersion = lang.versions.find((v) => v.default) || lang.versions[0];
  return defaultVersion?.id || "";
}

// Look up a beginner-friendly explanation for a keyword/symbol in a given language.
// Tries an exact (case-sensitive) match first, since most keywords are case-sensitive
// (e.g. Java/C# "public" vs a variable named "Public"), then falls back to a
// case-insensitive match so things still work if the user right-clicks "Public".
//
// `uiLang`: when it's "he", the Hebrew translation of `explanation` is used
// IF one exists for this exact keyword in keywords_he.json (`rtl: true`).
// Falls back to the English explanation (`rtl: false`) whenever the UI isn't
// Hebrew, the language has no keywords_he.json file, or that file doesn't
// have this particular keyword yet - `type`, the keyword name, and `example`
// always come from the English file and are never translated.
export function getKeywordExplanation(langId: string, word: string, uiLang?: string): ResolvedKeywordEntry | null {
  const lang = languages.get(langId);
  if (!lang || !word) return null;

  const dict = lang.keywords;
  let matchedKey: string | null = null;
  if (dict[word]) {
    matchedKey = word;
  } else {
    const lowerWord = word.toLowerCase();
    for (const key of Object.keys(dict)) {
      if (key.toLowerCase() === lowerWord) {
        matchedKey = key;
        break;
      }
    }
  }
  if (!matchedKey) return null;

  const entry = dict[matchedKey];
  if (uiLang === "he") {
    const heExplanation = lang.keywordsHe?.[matchedKey]?.explanation;
    if (heExplanation) {
      return { ...entry, explanation: heExplanation, rtl: true };
    }
  }
  return { ...entry, rtl: false };
}
