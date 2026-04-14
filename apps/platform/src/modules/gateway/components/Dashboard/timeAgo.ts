/**
 * Formats a date as a relative time in French.
 * Examples: "il y a 5 min", "il y a 2h", "hier", "il y a 3j", "le 12/04/2026"
 */
export function timeAgo(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'a l\'instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffHr < 24) return `il y a ${diffHr}h`;
  if (diffDay === 1) return 'hier';
  if (diffDay < 7) return `il y a ${diffDay}j`;
  if (diffDay < 30) return `il y a ${Math.floor(diffDay / 7)} sem`;
  // Older — show date
  return `le ${date.toLocaleDateString('fr-FR')}`;
}
