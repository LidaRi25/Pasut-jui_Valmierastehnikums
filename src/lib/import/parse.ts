// Kataloga importa faila (CSV / XLSX) nolasīšana. Tikai parsēšana un tīrīšana — bez piekļuves datubāzei.
import ExcelJS from 'exceljs';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20000;

export interface RawImportRow {
  line: number;
  name: string;
  unit: string;
  category: string;
  packaging: string;
  notes: string;
}

export interface ParsedImport {
  rows: RawImportRow[];
  /** Faila līmeņa problēmas (nepazīstamas kolonnas u.c.) */
  warnings: string[];
  truncated: boolean;
}

export class ImportFileError extends Error {}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const HEADERS: Record<keyof Omit<RawImportRow, 'line'>, string[]> = {
  name: ['precesnosaukums', 'nosaukums', 'prece', 'produkts', 'name', 'precematerials', 'precesnosaukumsmaterials'],
  unit: ['mervieniba', 'merv', 'mervienibas', 'vieniba', 'unit'],
  category: ['kategorija', 'category'],
  packaging: ['iepakojums', 'packaging', 'package'],
  notes: ['piezime', 'piezimes', 'note', 'notes', 'komentars'],
};

/** Atbrīvo šūnas tekstu no kontrolsimboliem, liekām atstarpēm; pārvērš objektus (formulas, rich text) tekstā. */
export function cleanCell(value: unknown): string {
  let text = '';
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else if (value instanceof Date) text = value.toISOString().slice(0, 10);
  else if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) text = (v.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    else if ('result' in v && v.result !== undefined && v.result !== null) text = cleanCell(v.result);
    else if (typeof v.text === 'string') text = v.text;
    else if (typeof v.hyperlink === 'string' && typeof v.text === 'string') text = v.text;
  }
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

/** Vienkāršs RFC 4180 CSV parsētājs (pēdiņas, rindu pārtraukumi laukos) ar norādītu norobežotāju. */
export function parseCsv(text: string, sep: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_IMPORT_ROWS + 5) break;
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Norobežotāju nosaka pēc galvenes rindas (nevis pirmās faila rindas — pirms tās var būt virsraksts vai tukšas rindas):
 * izmēģina ; , un tabulāciju un ņem to, ar kuru tiek atrasta kolonna "Preces nosaukums".
 */
export function parseCsvAuto(text: string): { matrix: string[][]; delimiter: string } | null {
  for (const sep of [';', '\t', ',']) {
    const matrix = parseCsv(text, sep);
    if (matrix.some((r) => r.some((c) => HEADERS.name.includes(norm(c))))) return { matrix, delimiter: sep };
  }
  return null;
}

function decodeText(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  // Excel "CSV (ANSI)" Latvijā ir windows-1257; ja UTF-8 dekodēšana dod aizstāšanas simbolus, mēģinām to
  if (utf8.includes('�')) {
    try {
      return new TextDecoder('windows-1257').decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

function toRows(matrix: string[][]): ParsedImport {
  // Galvenes rinda: pirmā rinda, kurā atrodama kolonna "nosaukums"
  const headerIdx = matrix.findIndex((r) => r.some((c) => HEADERS.name.includes(norm(c))));
  if (headerIdx < 0) {
    throw new ImportFileError('Failā netika atrasta kolonna «Preces nosaukums». Pārbaudiet galvenes rindu.');
  }
  const header = matrix[headerIdx].map(norm);
  const col = (key: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[key].includes(h));
  const idx = { name: col('name'), unit: col('unit'), category: col('category'), packaging: col('packaging'), notes: col('notes') };
  const warnings: string[] = [];
  if (idx.unit < 0) warnings.push('Failā nav kolonnas «Mērvienība» — visām rindām mērvienība būs jānorāda.');
  const known = new Set(Object.values(HEADERS).flat());
  const unknown = matrix[headerIdx].filter((c) => c.trim() !== '' && !known.has(norm(c)));
  if (unknown.length) warnings.push(`Nepazīstamas kolonnas tiks ignorētas: ${unknown.map((c) => `«${cleanCell(c).slice(0, 40)}»`).join(', ')}.`);

  const rows: RawImportRow[] = [];
  let truncated = false;
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    const get = (k: number) => (k >= 0 ? cleanCell(r[k]) : '');
    const row: RawImportRow = { line: i + 1, name: get(idx.name), unit: get(idx.unit), category: get(idx.category), packaging: get(idx.packaging), notes: get(idx.notes) };
    if (!row.name && !row.unit && !row.category && !row.packaging && !row.notes) continue;
    if (rows.length >= MAX_IMPORT_ROWS) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return { rows, warnings, truncated };
}

/** Nolasa augšupielādētu failu (.xlsx vai .csv). Meta ImportFileError ar latvisku tekstu, ja fails nav derīgs. */
export async function parseImportFile(buffer: Buffer, filename: string): Promise<ParsedImport> {
  if (buffer.length === 0) throw new ImportFileError('Fails ir tukšs.');
  if (buffer.length > MAX_IMPORT_BYTES) throw new ImportFileError('Fails ir pārāk liels (maksimums 5 MB).');
  const lower = filename.toLowerCase();
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;

  if (lower.endsWith('.xlsx')) {
    if (!isZip) throw new ImportFileError('Fails nav derīgs .xlsx dokuments.');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new ImportFileError('Excel failu neizdevās nolasīt. Pārbaudiet, vai tas nav bojāts vai aizsargāts ar paroli.');
    }
    const sheet = wb.worksheets.find((ws) => ws.actualRowCount > 0);
    if (!sheet) throw new ImportFileError('Excel failā nav datu.');
    const matrix: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_IMPORT_ROWS + 50) return;
      const values = row.values as unknown[];
      matrix[rowNumber - 1] = values.slice(1).map((v) => cleanCell(v));
    });
    for (let i = 0; i < matrix.length; i++) matrix[i] ??= [];
    return toRows(matrix);
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    if (isZip || buffer.includes(0)) throw new ImportFileError('Fails nav teksta (CSV) formātā.');
    const auto = parseCsvAuto(decodeText(buffer));
    if (!auto) throw new ImportFileError('Failā netika atrasta kolonna «Preces nosaukums». Pārbaudiet galvenes rindu.');
    return toRows(auto.matrix);
  }
  throw new ImportFileError('Atbalstītie formāti: .xlsx un .csv.');
}

export { norm as normalizeHeader };
