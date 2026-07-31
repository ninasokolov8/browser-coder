/**
 * Language metadata and starter templates.
 *
 * The config cache lives here with the routes that use it, rather than as two
 * loose `let` bindings in the composition root. It is a five-minute cache of files
 * that only change on deploy, so its only job is to keep a directory scan off the
 * hot path.
 */

import fs from 'node:fs';
import path from 'node:path';

import { extensionFor } from '../../languages/catalog.mjs';

const CACHE_TTL_MS = 300_000;

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {string} deps.rootDir   the repo root, so `languages/` can be found
 * @param {Function} deps.log
 */
export function registerLanguageRoutes(app, { rootDir, log }) {
  const languagesDir = path.join(rootDir, 'languages');

  let cache = null;
  let cachedAt = 0;

  async function loadLanguageConfigs() {
    if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

    const languages = {};
    try {
      for (const dir of fs.readdirSync(languagesDir)) {
        const configPath = path.join(languagesDir, dir, 'config.json');
        if (fs.existsSync(configPath)) {
          languages[dir] = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
      }
    } catch (error) {
      log('error', 'Failed to load language configs', { error: error.message });
    }

    cache = languages;
    cachedAt = Date.now();
    return languages;
  }

  app.get('/api/languages', async (req, res) => {
    try {
      res.json(await loadLanguageConfigs());
    } catch {
      res.status(500).json({ error: 'Failed to load languages' });
    }
  });

  app.get('/api/starter/:language/:version', async (req, res) => {
    try {
      const { language, version } = req.params;

      // The extension comes from the catalog rather than a map maintained here.
      // Hardcoding one duplicated languages/*/config.json, so adding a language
      // meant editing the core (N-09).
      const starterPath = path.join(
        languagesDir,
        language,
        'starters',
        `${version}.${extensionFor(language)}`,
      );

      // `language` and `version` are path segments from the URL. Express has
      // already decoded them, so containment is re-checked here rather than
      // assumed - a `..` segment would otherwise read any file under the repo.
      const resolvedRoot = path.resolve(languagesDir);
      const resolved = path.resolve(starterPath);
      if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        return res.status(404).json({ error: 'Starter not found' });
      }

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: 'Starter not found' });
      }

      res.json({ code: fs.readFileSync(resolved, 'utf-8') });
    } catch {
      res.status(500).json({ error: 'Failed to load starter' });
    }
  });
}
