/**
 * Confluence service — fetches pages and spaces using the Jira connector credentials.
 * Reads auth from user_connectors via getJiraContext (same as delivery module).
 */

import { getJiraContext, type JiraContext } from '../../jiraAuth.js';

export interface ConfluenceSpace {
  key: string;
  name: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  spaceKey: string;
  url: string;
  body: string;
}

function getConfluenceBaseUrl(ctx: JiraContext): string {
  if (ctx.isOAuth) {
    // OAuth baseUrl: https://api.atlassian.com/ex/jira/<cloud_id>
    // Confluence OAuth base: https://api.atlassian.com/ex/confluence/<cloud_id>
    return ctx.baseUrl.replace('/ex/jira/', '/ex/confluence/');
  }
  // Basic auth baseUrl: https://company.atlassian.net (strip /rest/... if present)
  return ctx.baseUrl.replace(/\/rest\/.*$/, '');
}

export async function isConfluenceConfigured(userId: number): Promise<boolean> {
  const ctx = await getJiraContext(userId);
  return ctx !== null;
}

export async function fetchSpaces(userId: number): Promise<ConfluenceSpace[]> {
  const ctx = await getJiraContext(userId);
  if (!ctx) throw new Error('Jira/Confluence connector not configured');

  const base = getConfluenceBaseUrl(ctx);
  const response = await fetch(
    `${base}/wiki/rest/api/space?type=global&limit=50`,
    { headers: ctx.headers }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Confluence spaces error: ${response.status} ${err}`);
  }

  const data = await response.json() as { results: { key: string; name: string }[] };
  return data.results.map((s) => ({ key: s.key, name: s.name }));
}

export async function fetchPagesInSpace(userId: number, spaceKey: string): Promise<ConfluencePage[]> {
  const ctx = await getJiraContext(userId);
  if (!ctx) throw new Error('Jira/Confluence connector not configured');

  const base = getConfluenceBaseUrl(ctx);
  const pages: ConfluencePage[] = [];
  let start = 0;
  const limit = 25;

  while (true) {
    const url = `${base}/wiki/rest/api/content?spaceKey=${spaceKey}&type=page&expand=body.storage&start=${start}&limit=${limit}`;
    const response = await fetch(url, { headers: ctx.headers });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Confluence pages error (${spaceKey}): ${response.status} ${err}`);
    }

    const data = await response.json() as {
      results: { id: string; title: string; body: { storage: { value: string } }; _links: { webui: string } }[];
      size: number;
    };

    for (const page of data.results) {
      pages.push({
        id: page.id,
        title: page.title,
        spaceKey,
        url: `${base}/wiki${page._links.webui}`,
        body: stripHtml(page.body.storage.value),
      });
    }

    if (data.results.length < limit) break;
    start += limit;
  }

  return pages;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitIntoChunks(text: string, maxChars = 1500): { heading: string | null; content: string }[] {
  const sections = text.split(/(?=\n#{1,3}\s)/);
  const chunks: { heading: string | null; content: string }[] = [];

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const heading = lines[0].match(/^#{1,3}\s/) ? lines[0].replace(/^#+\s*/, '') : null;
    const content = heading ? lines.slice(1).join('\n').trim() : section.trim();

    if (!content) continue;

    for (let i = 0; i < content.length; i += maxChars) {
      chunks.push({ heading, content: content.slice(i, i + maxChars) });
    }
  }

  if (chunks.length > 0) return chunks;
  if (!text.trim()) return [];
  return [{ heading: null, content: text.slice(0, 2000) }];
}
