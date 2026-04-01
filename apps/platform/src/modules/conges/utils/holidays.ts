/**
 * French public holidays (jours fériés) for 2025–2027.
 * Extend as needed when adding future years.
 */
export const FRENCH_HOLIDAYS = new Set<string>([
  // 2025
  '2025-01-01', // Jour de l'An
  '2025-04-21', // Lundi de Pâques
  '2025-05-01', // Fête du Travail
  '2025-05-08', // Victoire 1945
  '2025-05-29', // Ascension
  '2025-06-09', // Lundi de Pentecôte
  '2025-07-14', // Fête Nationale
  '2025-08-15', // Assomption
  '2025-11-01', // Toussaint
  '2025-11-11', // Armistice
  '2025-12-25', // Noël

  // 2026
  '2026-01-01', // Jour de l'An
  '2026-04-06', // Lundi de Pâques
  '2026-05-01', // Fête du Travail
  '2026-05-08', // Victoire 1945
  '2026-05-14', // Ascension
  '2026-05-25', // Lundi de Pentecôte
  '2026-07-14', // Fête Nationale
  '2026-08-15', // Assomption
  '2026-11-01', // Toussaint
  '2026-11-11', // Armistice
  '2026-12-25', // Noël

  // 2027
  '2027-01-01', // Jour de l'An
  '2027-03-29', // Lundi de Pâques
  '2027-05-01', // Fête du Travail
  '2027-05-08', // Victoire 1945
  '2027-05-06', // Ascension
  '2027-05-17', // Lundi de Pentecôte
  '2027-07-14', // Fête Nationale
  '2027-08-15', // Assomption
  '2027-11-01', // Toussaint
  '2027-11-11', // Armistice
  '2027-12-25', // Noël
]);

export function isHoliday(dateStr: string): boolean {
  return FRENCH_HOLIDAYS.has(dateStr);
}

export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr);
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

export function getDateRangeWarnings(start: string, end: string): string[] {
  if (!start) return [];
  const warnings: string[] = [];
  const endDate = end || start;

  let hasWeekend = false;
  let hasHoliday = false;
  let holidayNames: string[] = [];

  const current = new Date(start);
  const last = new Date(endDate);

  while (current <= last) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    if (isWeekend(dateStr)) hasWeekend = true;
    if (isHoliday(dateStr)) {
      hasHoliday = true;
      holidayNames.push(dateStr);
    }
    current.setDate(current.getDate() + 1);
  }

  if (hasWeekend) {
    warnings.push('La période sélectionnée inclut un ou plusieurs jours de week-end.');
  }
  if (hasHoliday) {
    const label = holidayNames.length === 1
      ? `un jour férié (${holidayNames[0]})`
      : `${holidayNames.length} jours fériés`;
    warnings.push(`La période sélectionnée inclut ${label}.`);
  }

  return warnings;
}
