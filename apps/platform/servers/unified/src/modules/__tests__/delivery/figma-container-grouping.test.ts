import { describe, it, expect } from 'vitest';
import { generateContainerSvg } from '../../delivery/figmaExport.js';

// When the user pastes the "Copier pour Figma" SVG into Figma, every
// chip must be wrapped in its own <g> so it surfaces as a single
// selectable subgroup. Otherwise the whole container becomes one
// flattened block and individual chips can't be moved unitarily.

describe('delivery — figmaExport.generateContainerSvg chip grouping', () => {
  const baseTask = {
    jiraKey: 'CONTAINER',
    title: 'Anomalies sprint 12',
    status: 'in_progress',
    version: null,
    estimatedDays: null,
    colSpan: 1,
  };

  it('wraps every chip in a <g> with a data-name attribute', () => {
    const svg = generateContainerSvg(baseTask, [
      { jiraKey: 'TVSMART-101', title: 'Bug login mobile', status: 'todo', storyPoints: 3 },
      { jiraKey: 'TVSMART-102', title: 'Crash AnimateChange', status: 'in_progress', storyPoints: 5 },
      { jiraKey: 'TVSMART-103', title: 'Refonte router', status: 'done', storyPoints: 8 },
    ]);
    // One <g data-name="…"> per chip + one for the header
    const matches = svg.match(/<g data-name="[^"]+">/g) ?? [];
    expect(matches.length).toBe(4);
    // Each chip group should carry the Jira key as its name.
    expect(svg).toContain('<g data-name="TVSMART-101">');
    expect(svg).toContain('<g data-name="TVSMART-102">');
    expect(svg).toContain('<g data-name="TVSMART-103">');
  });

  it('wraps the header (title + days badge) in its own <g>', () => {
    const svg = generateContainerSvg(baseTask, [
      { jiraKey: 'X-1', title: 'foo', status: 'todo', storyPoints: 1 },
    ]);
    expect(svg).toContain('<g data-name="Header">');
  });

  it('falls back to "Chip #N" for chips with no Jira key', () => {
    const svg = generateContainerSvg(baseTask, [
      { jiraKey: '', title: 'unkeyed', status: 'todo', storyPoints: 0 },
    ]);
    expect(svg).toContain('<g data-name="Chip #1">');
  });

  it('escapes XML special chars in the chip group name', () => {
    const svg = generateContainerSvg(baseTask, [
      { jiraKey: 'X-1 & Y-2', title: 'foo', status: 'todo', storyPoints: 0 },
    ]);
    expect(svg).toContain('<g data-name="X-1 &amp; Y-2">');
  });

  it('keeps the chip background, status dot and labels INSIDE the chip <g>', () => {
    const svg = generateContainerSvg(baseTask, [
      { jiraKey: 'TV-42', title: 'titre', status: 'todo', storyPoints: 2 },
    ]);
    // Locate the chip group's full body and confirm the inner shapes
    // sit between its opening and closing tags.
    const chipMatch = svg.match(/<g data-name="TV-42">([\s\S]*?)<\/g>/);
    expect(chipMatch).not.toBeNull();
    const inner = chipMatch![1];
    expect(inner).toContain('<rect'); // chip background + jira badge
    expect(inner).toContain('<circle'); // status dot
    expect(inner).toContain('TV-42'); // jira label text
    expect(inner).toContain('titre'); // chip title
  });
});
