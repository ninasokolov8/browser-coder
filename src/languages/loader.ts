// Dynamic language loader for frontend
// Loads configs at build time with Vite glob, starters fetched from server at runtime
// Optimized for high-traffic with caching and batch loading

import type { LanguageConfig, LoadedLanguage, VersionConfig } from "./types";
import { LANGUAGE_ICONS } from "./types";

// Import all config.json files at build time
const configModules = import.meta.glob<{ default: LanguageConfig }>(
  "/languages/*/config.json",
  { eager: true }
);

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
    });
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
