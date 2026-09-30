// Datuma/laika formatēšana latviešu formātā, vienmēr Europe/Riga laika joslā
// (serveris Vercel darbojas UTC, tāpēc laika josla jānorāda skaidri).

export const TIME_ZONE = 'Europe/Riga';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(d: Date) {
  const out: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(d)) out[p.type] = p.value;
  return out as { year: string; month: string; day: string; hour: string; minute: string };
}

/** "2026-10-29" (date) -> "29.10.2026." */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${m[3]}.${m[2]}.${m[1]}.`;
}

/** timestamptz -> "29.10.2026. 14:30" (Rīgas laiks) */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d);
  return `${p.day}.${p.month}.${p.year}. ${p.hour}:${p.minute}`;
}

/** timestamptz -> "yyyy-MM-ddTHH:mm" (datetime-local ievadei, Rīgas laiks) */
export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "yyyy-MM-ddTHH:mm" (Rīgas vietējais laiks) -> UTC ISO virkne; null, ja nederīgs. */
export function localRigaToIso(local: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local ?? '');
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Atrod nobīdi: formatējam tuvinājumu Rīgas laikā un salīdzinām
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += asUtc - shown;
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

export function formatRequestNo(no: number | string | null | undefined): string {
  if (no === null || no === undefined) return '';
  return 'P-' + String(no).padStart(6, '0');
}

/** Šodienas datums Rīgas laikā formātā yyyy-MM-dd */
export function todayRiga(now: Date = new Date()): string {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Cik laika atlicis līdz termiņam, cilvēkam saprotamā formā. */
export function timeLeft(deadlineIso: string, now: Date = new Date()): string {
  const ms = new Date(deadlineIso).getTime() - now.getTime();
  if (ms <= 0) return 'termiņš beidzies';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days >= 2) return `atlikušas ${days} dienas`;
  if (days === 1) return `atlikusi 1 diena un ${hours} h`;
  if (hours >= 1) return `atlikušas ${hours} h ${minutes % 60} min`;
  return `atlikušas ${minutes} min`;
}
