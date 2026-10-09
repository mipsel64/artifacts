const DAY_MS = 24 * 3600 * 1000;

export const formatDate = (iso: string) => iso.slice(0, 10);

export function retentionLabel(expiresAt: string | null, now: Date): string {
  if (expiresAt === null) return 'Permanent';
  const days = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS);
  return days <= 1 ? 'Expires within a day' : `Expires in ${days} days`;
}
