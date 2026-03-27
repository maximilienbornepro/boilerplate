import type { Sprint } from '../types';

interface Increment {
  id: string;
  name: string;
  sprints: Sprint[];
}

// Generate all increments for 2026
export function generateIncrements2026(): Increment[] {
  const increments: Increment[] = [];
  let currentDate = new Date('2026-01-19');

  for (let incNum = 1; incNum <= 8; incNum++) {
    const sprints: Sprint[] = [];

    for (let sprintNum = 1; sprintNum <= 3; sprintNum++) {
      const startDate = new Date(currentDate);
      const endDate = new Date(currentDate);
      endDate.setDate(endDate.getDate() + 13); // 2 weeks - 1 day

      sprints.push({
        id: `inc${incNum}-s${sprintNum}`,
        name: `S${sprintNum} Increment ${incNum} 2026`,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });

      currentDate.setDate(currentDate.getDate() + 14); // Move to next sprint
    }

    increments.push({
      id: `inc${incNum}`,
      name: `Increment ${incNum} 2026`,
      sprints,
    });
  }

  return increments;
}
