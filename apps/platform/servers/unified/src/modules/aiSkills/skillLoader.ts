// Public API for services that need a skill prompt : `loadSkill(slug)`.
// Looks in the DB first (so admin edits win), falls back to the shipped file
// if the DB is unavailable or the row hasn't been seeded yet.

import { readFile } from 'node:fs/promises';
import { getSkill, type SkillDefinition } from './registry.js';
import { getSkillBySlug } from './dbService.js';

/** Returns the current content of a skill as raw markdown, ready to be spliced
 *  into a prompt. Never throws — returns a minimal fallback if everything
 *  fails so the AI call can still proceed. */
export async function loadSkill(slug: string): Promise<string> {
  const def = getSkill(slug);
  if (!def) {
    return `[Skill inconnu: ${slug}]`;
  }

  // 1) DB first — that's where admin edits live.
  try {
    const row = await getSkillBySlug(slug);
    if (row && row.content.trim().length > 0) {
      return row.content;
    }
  } catch {
    // DB unavailable — fall through to file.
  }

  // 2) Shipped file as a safety net.
  return readDefaultFile(def);
}

export async function readDefaultFile(def: SkillDefinition): Promise<string> {
  try {
    return await readFile(def.defaultFilePath, 'utf-8');
  } catch {
    return `# ${def.name}\n\n(Fichier skill introuvable : ${def.defaultFilePath})`;
  }
}
