import { existsSync } from 'node:fs';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

/**
 * Loads `.env` files before anything reads `process.env` (OPS-07).
 *
 * The API can be started from the repo root or from `apps/api` (npm workspaces set cwd to the
 * package), so we look in both places. Values already present in the environment win, which
 * keeps Docker/CI configuration authoritative.
 */
export function loadEnvFiles(cwd: string = process.cwd()): string[] {
  const candidates = [path.resolve(cwd, '.env'), path.resolve(cwd, '../../.env')];
  const loaded: string[] = [];
  for (const file of new Set(candidates)) {
    if (existsSync(file)) {
      loadDotenv({ path: file, quiet: true });
      loaded.push(file);
    }
  }
  return loaded;
}
