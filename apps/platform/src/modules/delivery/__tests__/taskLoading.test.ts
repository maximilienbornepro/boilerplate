import { describe, it, expect } from 'vitest';
import { buildRowTracker, tasksOverlap, resolveCollisions } from '../utils/taskLoading';

// --- buildRowTracker ---
describe('buildRowTracker', () => {
  it('initialise à 0 pour chaque colonne si pas de positions', () => {
    const tracker = buildRowTracker([]);
    expect(tracker[0]).toBe(0);
    expect(tracker[2]).toBe(0);
    expect(tracker[4]).toBe(0);
  });

  it('calcule correctement la prochaine rangée disponible', () => {
    const positions = [
      { startCol: 0, row: 0, rowSpan: 1 },
      { startCol: 0, row: 1, rowSpan: 1 },
      { startCol: 2, row: 0, rowSpan: 1 },
    ];
    const tracker = buildRowTracker(positions);
    expect(tracker[0]).toBe(2); // rows 0 and 1 used
    expect(tracker[2]).toBe(1); // row 0 used
    expect(tracker[4]).toBe(0); // nothing
  });

  it('prend en compte le rowSpan pour les conteneurs', () => {
    const positions = [
      { startCol: 0, row: 0, rowSpan: 3 }, // spans rows 0, 1, 2
    ];
    const tracker = buildRowTracker(positions);
    expect(tracker[0]).toBe(3); // next available = row 3
  });

  it('ignore les colonnes invalides', () => {
    const positions = [
      { startCol: 1, row: 5, rowSpan: 1 }, // col 1 is not tracked
      { startCol: 3, row: 5, rowSpan: 1 }, // col 3 is not tracked
    ];
    const tracker = buildRowTracker(positions);
    expect(tracker[0]).toBe(0);
    expect(tracker[2]).toBe(0);
    expect(tracker[4]).toBe(0);
  });
});

// --- tasksOverlap ---
describe('tasksOverlap', () => {
  const box = (startCol: number, endCol: number, row: number, rowSpan: number, id = 'x') => ({
    id, startCol, endCol, row, rowSpan,
  });

  it('détecte un chevauchement total', () => {
    const a = box(0, 4, 0, 2);
    const b = box(1, 3, 0, 2);
    expect(tasksOverlap(a, b)).toBe(true);
  });

  it('détecte un chevauchement partiel horizontal', () => {
    const a = box(0, 3, 0, 1);
    const b = box(2, 5, 0, 1);
    expect(tasksOverlap(a, b)).toBe(true);
  });

  it('détecte un chevauchement partiel vertical', () => {
    const a = box(0, 2, 0, 2);
    const b = box(0, 2, 1, 2);
    expect(tasksOverlap(a, b)).toBe(true);
  });

  it('ne détecte pas de chevauchement quand les taches sont cote à cote', () => {
    const a = box(0, 2, 0, 1);
    const b = box(2, 4, 0, 1);
    expect(tasksOverlap(a, b)).toBe(false);
  });

  it('ne détecte pas de chevauchement quand les taches sont sur des rangées différentes', () => {
    const a = box(0, 2, 0, 1);
    const b = box(0, 2, 1, 1);
    expect(tasksOverlap(a, b)).toBe(false);
  });

  it('ne détecte pas de chevauchement quand les taches sont espacées verticalement', () => {
    const a = box(0, 2, 0, 1);
    const b = box(0, 2, 2, 1);
    expect(tasksOverlap(a, b)).toBe(false);
  });

  it('ne détecte pas de chevauchement quand les rangées sont adjacentes (row + rowSpan)', () => {
    const a = box(0, 2, 0, 2); // rows 0-1
    const b = box(0, 2, 2, 1); // row 2
    expect(tasksOverlap(a, b)).toBe(false);
  });
});

// --- resolveCollisions ---
describe('resolveCollisions', () => {
  const box = (id: string, startCol: number, endCol: number, row: number, rowSpan = 1) => ({
    id, startCol, endCol, row, rowSpan,
  });

  it('ne modifie rien si pas de collision', () => {
    const positions = [
      box('a', 0, 2, 0),
      box('b', 0, 2, 1),
    ];
    const result = resolveCollisions(positions, 'a');
    expect(result.find(p => p.id === 'a')!.row).toBe(0);
    expect(result.find(p => p.id === 'b')!.row).toBe(1);
  });

  it('pousse la tache chevauchante vers le bas', () => {
    const positions = [
      box('a', 0, 2, 0, 2), // spans rows 0-1
      box('b', 0, 2, 0),    // starts at row 0 → collision with a
    ];
    const result = resolveCollisions(positions, 'a');
    const bRow = result.find(p => p.id === 'b')!.row;
    expect(bRow).toBe(2); // pushed past end of 'a' (row 0 + rowSpan 2)
  });

  it('retourne un résultat si movedId introuvable', () => {
    const positions = [box('x', 0, 2, 0)];
    const result = resolveCollisions(positions, 'unknown');
    expect(result).toHaveLength(1);
    expect(result[0].row).toBe(0);
  });

  it('ne modifie pas la position de la tache déplacée', () => {
    const positions = [
      box('moved', 0, 4, 0, 1),
      box('other', 1, 3, 0, 1), // overlaps
    ];
    const result = resolveCollisions(positions, 'moved');
    // 'moved' position should not change
    expect(result.find(p => p.id === 'moved')!.row).toBe(0);
    // 'other' should be pushed down
    expect(result.find(p => p.id === 'other')!.row).toBeGreaterThan(0);
  });

  it('résout les réactions en chaîne — aucun chevauchement restant', () => {
    // a spans rows 0-1. b starts at row 0 (collision). c at row 2 may collide with pushed b.
    const positions = [
      box('a', 0, 2, 0, 2),
      box('b', 0, 2, 0, 1), // overlaps with a, will be pushed to row 2
      box('c', 0, 2, 2, 1), // at row 2 — may collide with b after push
    ];
    const result = resolveCollisions(positions, 'a');

    // After resolution, no two different tasks should overlap
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        expect(tasksOverlap(result[i], result[j])).toBe(false);
      }
    }

    // b must have been pushed away from a
    const bRow = result.find(p => p.id === 'b')!.row;
    expect(bRow).toBeGreaterThanOrEqual(2);
  });
});
