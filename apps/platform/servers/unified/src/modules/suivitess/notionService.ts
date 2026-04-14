// Notion service — list databases and create pages via Notion API
// Uses API key from user_connectors (service='notion')

import pg from 'pg';
import { config } from '../../config.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: config.appDatabaseUrl });

const NOTION_VERSION = '2022-06-28';

async function getApiKey(userId: number): Promise<string> {
  const { rows } = await pool.query(
    `SELECT config FROM user_connectors WHERE user_id = $1 AND service = 'notion' AND is_active = true`,
    [userId]
  );
  if (!rows.length) throw new Error('Notion non connecte');
  const cfg = rows[0].config as { apiKey?: string };
  if (!cfg.apiKey) throw new Error('Cle API Notion manquante');
  return cfg.apiKey;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
}

export async function listNotionDatabases(userId: number): Promise<NotionDatabase[]> {
  const apiKey = await getApiKey(userId);
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: { property: 'object', value: 'database' },
      page_size: 100,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error: ${res.status} — ${err}`);
  }
  const data = await res.json() as { results: Array<{ id: string; title?: Array<{ plain_text: string }>; url: string }> };
  return data.results.map(db => ({
    id: db.id,
    title: db.title?.map(t => t.plain_text).join('') || 'Sans titre',
    url: db.url,
  }));
}

export async function createNotionPage(
  userId: number,
  databaseId: string,
  title: string,
  content: string,
): Promise<{ id: string; url: string }> {
  const apiKey = await getApiKey(userId);

  // Build children blocks from content (split paragraphs)
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
  const children = paragraphs.map(p => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: p.slice(0, 2000) } }],
    },
  }));

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        // Assume the database has a title property named "Name" or "title"
        // Notion requires the title property — we use the default "Name"
        Name: {
          title: [{ type: 'text', text: { content: title.slice(0, 2000) } }],
        },
      },
      children,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    // Fallback: try with "title" property if "Name" failed
    if (res.status === 400 && err.includes('Name')) {
      const res2 = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: {
            title: { title: [{ type: 'text', text: { content: title.slice(0, 2000) } }] },
          },
          children,
        }),
      });
      if (!res2.ok) throw new Error(`Notion API error: ${res2.status} — ${await res2.text()}`);
      const data = await res2.json() as { id: string; url: string };
      return { id: data.id, url: data.url };
    }
    throw new Error(`Notion API error: ${res.status} — ${err}`);
  }
  const data = await res.json() as { id: string; url: string };
  return { id: data.id, url: data.url };
}
