const DAY_MS = 24 * 3600 * 1000;

export const formatDate = (iso: string) => iso.slice(0, 10);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Oct 9, 14:02" in UTC, so the server render and the tests agree.
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${time}`;
}

export function retentionLabel(expiresAt: string | null, now: Date): string {
  if (expiresAt === null) return 'Permanent';
  const days = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
  return days <= 1 ? 'Expires within a day' : `Expires in ${days} days`;
}
