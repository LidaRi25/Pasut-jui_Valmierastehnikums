// Decimālskaitļu apstrāde bez peldošā komata (JavaScript number) kļūdām.
// Daudzumi tiek glabāti kā numeric(14,3) datubāzē un JavaScript pusē kā teksts / BigInt (×1000).

export const QTY_SCALE = 3;
const FACTOR = 10n ** BigInt(QTY_SCALE);
const MAX_INTEGER_DIGITS = 11; // numeric(14,3)

/** DB `numeric` kolonnas PostgREST atgriež kā JSON skaitļus — pārvēršam par tekstu (līdz 14 zīmēm tas ir bez zudumiem). */
export type NumericLike = string | number | null | undefined;

/** Normalizē DB skaitli (skaitlis vai teksts) uz kanonisku tekstu; null, ja nav vērtības. */
export function numStr(v: NumericLike): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    const t = String(v);
    return t.includes('e') || t.includes('E') ? v.toFixed(6) : t;
  }
  return v;
}

export type ParseResult =
  | { ok: true; value: string } // kanoniska forma ar punktu, piem. "0.5"
  | { ok: false; reason: 'empty' | 'invalid' | 'too_precise' | 'too_large' };

/**
 * Pieņem gan "0,5", gan "0.5" (arī "1 000,5" ar atstarpēm kā tūkstošu atdalītāju).
 * Noraida neskaidros formātus ("1.234,5", "1,2,3", "abc", "1e3").
 */
export function parseDecimal(input: NumericLike, scale = QTY_SCALE): ParseResult {
  const raw = (numStr(input) ?? '').replace(/[\s ]/g, '');
  if (raw === '') return { ok: false, reason: 'empty' };
  if (/[.,].*[.,]/.test(raw)) return { ok: false, reason: 'invalid' };
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(raw)) return { ok: false, reason: 'invalid' };
  const normalized = raw.replace(',', '.');
  const negative = normalized.startsWith('-');
  const unsigned = normalized.replace(/^[+-]/, '');
  const [intPartRaw, fracRaw = ''] = unsigned.split('.');
  const intPart = (intPartRaw || '0').replace(/^0+(?=\d)/, '');
  const frac = fracRaw.replace(/0+$/, '');
  if (frac.length > scale) return { ok: false, reason: 'too_precise' };
  if (intPart.length > MAX_INTEGER_DIGITS) return { ok: false, reason: 'too_large' };
  const value = (negative && (intPart !== '0' || frac !== '') ? '-' : '') + intPart + (frac ? '.' + frac : '');
  return { ok: true, value };
}

/** Teksts -> BigInt (×1000). Meta kļūdu, ja teksts nav derīgs. */
export function toScaled(value: NumericLike): bigint {
  const parsed = parseDecimal(value);
  if (!parsed.ok) throw new Error(`Nederīgs skaitlis: ${value}`);
  const neg = parsed.value.startsWith('-');
  const [i, f = ''] = parsed.value.replace('-', '').split('.');
  const scaled = BigInt(i) * FACTOR + BigInt((f + '000').slice(0, QTY_SCALE));
  return neg ? -scaled : scaled;
}

/** BigInt (×1000) -> kanonisks teksts ar noņemtām liekajām nullēm. */
export function fromScaled(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const i = abs / FACTOR;
  const f = (abs % FACTOR).toString().padStart(QTY_SCALE, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + i.toString() + (f ? '.' + f : '');
}

/** Precīza summa (BigInt aritmētika). Tukšs saraksts -> "0". */
export function sumDecimals(values: NumericLike[]): string {
  let total = 0n;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    total += toScaled(v);
  }
  return fromScaled(total);
}

export function compareDecimals(a: NumericLike, b: NumericLike): number {
  const x = toScaled(a);
  const y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isPositive(value: string): boolean {
  return toScaled(value) > 0n;
}

/**
 * Attēlo daudzumu latviešu formātā: decimālkomats, atstarpe kā tūkstošu atdalītājs.
 *  - nepārtrauktām vienībām (kg, g, L, ml): vismaz 1 zīme aiz komata — "0,5", "4,0", "1,125"
 *  - skaitāmām vienībām (gab., iep., ...): bez decimāldaļas, ja skaitlis ir vesels — "3", "0,5"
 * Pieņem gan tekstu ("4.000"), gan skaitli (no numeric kolonnas, kas atnāk kā teksts).
 */
export function formatQuantity(value: NumericLike, countable = false): string {
  const text = numStr(value);
  if (text === null) return '';
  const parsed = parseDecimal(text, 6);
  if (!parsed.ok) return text;
  const [i, fracRaw = ''] = parsed.value.split('.');
  // aizsardzība pret > 3 zīmēm (piem., 0.600000 no aprēķiniem)
  const trimmed = fracRaw.slice(0, QTY_SCALE).replace(/0+$/, '');
  const f = !countable && trimmed === '' ? '0' : trimmed;
  const neg = i.startsWith('-');
  const digits = neg ? i.slice(1) : i;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + grouped + (f ? ',' + f : '');
}

/** Vērtība ievades laukam: kanoniska forma ar komatu, piem. "0.5" -> "0,5". */
export function toInputValue(value: NumericLike): string {
  const text = numStr(value);
  if (text === null) return '';
  const parsed = parseDecimal(text, 6);
  if (!parsed.ok) return text;
  const [i, f = ''] = parsed.value.split('.');
  const frac = f.slice(0, QTY_SCALE).replace(/0+$/, '');
  return i + (frac ? ',' + frac : '');
}
