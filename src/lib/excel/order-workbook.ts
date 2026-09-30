// Profesionāli noformēts Excel (.xlsx) pasūtījuma eksports ar Valmieras tehnikuma vizuālo identitāti:
// balts / melns pamats, VT zaļais (#00AD6F) tikai akcentiem. Fonts — Arial (DM Sans nav pieejams Excel vidē).
import ExcelJS from 'exceljs';
import { numStr } from '@/lib/decimal';
import { REQUEST_STATUS_LABEL, type RequestStatus } from '@/lib/labels';
import type { OrderLine, ReportRow, SummaryRow } from '@/lib/types';

const GREEN = 'FF00AD6F';
const GREEN_TINT = 'FFE6F6EF';
const BLACK = 'FF000000';
const WHITE = 'FFFFFFFF';
const GRAY = 'FFF4F5F6';
const LINE = 'FFB6BCC2';
const FONT = 'Arial';

export interface WorkbookInput {
  institution: string;
  periodLabel: string | null;
  filterLines: string[];
  generatedAt: Date;
  generatedBy: string;
  summary: SummaryRow[];
  lines: OrderLine[];
  byTeacher: ReportRow[];
  byGroup: ReportRow[];
  byDate: ReportRow[];
  byCategory: ReportRow[];
  /** Mērvienību kodi, kuras skaita veselos (gab., iep., ...) — skaitļu formātam */
  countableUnits: Set<string>;
}

export const SHEET_NAMES = {
  total: 'KOPĒJAIS PASŪTĪJUMS',
  detail: 'DETALIZĒTI',
  teachers: 'PA PEDAGOGIEM',
  groups: 'PA GRUPĀM',
  dates: 'PA DATUMIEM',
  categories: 'PA KATEGORIJĀM',
} as const;

const num = (v: unknown): number => {
  const s = numStr(v as string | number | null);
  return s === null ? 0 : Number(s);
};

const qtyFormat = (unit: string, countable: Set<string>, value: number) =>
  countable.has(unit) && Number.isInteger(value) ? '#,##0' : '#,##0.0##';

function isoToDate(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDateTime(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}.${g('month')}.${g('year')}. ${g('hour')}:${g('minute')}`;
}

interface Col {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

function baseSheet(wb: ExcelJS.Workbook, name: string, title: string, input: WorkbookInput, cols: Col[], tab: string): { ws: ExcelJS.Worksheet; headerRow: number } {
  const ws = wb.addWorksheet(name, {
    properties: { tabColor: { argb: tab } },
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  });
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
  const last = cols.length;

  // Virsraksta bloks
  const r1 = ws.getRow(1);
  r1.getCell(1).value = input.institution.toUpperCase();
  r1.getCell(1).font = { name: FONT, size: 14, bold: true, color: { argb: BLACK } };
  r1.height = 22;
  ws.getRow(2).getCell(1).value = title;
  ws.getRow(2).getCell(1).font = { name: FONT, size: 12, bold: true, color: { argb: 'FF007A4D' } };
  const meta: string[] = [];
  if (input.periodLabel) meta.push(`Periods: ${input.periodLabel}`);
  meta.push(...input.filterLines);
  meta.push(`Sagatavots: ${fmtDateTime(input.generatedAt)} (${input.generatedBy})`);
  let row = 3;
  for (const m of meta) {
    const cell = ws.getRow(row).getCell(1);
    cell.value = m;
    cell.font = { name: FONT, size: 9, color: { argb: 'FF3F4448' } };
    row++;
  }
  // Zaļā akcenta līnija zem virsraksta
  for (let c = 1; c <= last; c++) {
    ws.getRow(row).getCell(c).border = { top: { style: 'medium', color: { argb: GREEN } } };
  }
  ws.getRow(row).height = 6;
  row += 1;

  const headerRow = row;
  const hr = ws.getRow(headerRow);
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLACK } };
    cell.alignment = { vertical: 'middle', horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: GREEN } } };
  });
  hr.height = 24;
  ws.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  return { ws, headerRow };
}

function styleBodyRow(ws: ExcelJS.Worksheet, rowIdx: number, cols: Col[], zebra: boolean) {
  const r = ws.getRow(rowIdx);
  cols.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    cell.font = { name: FONT, size: 10, color: { argb: BLACK }, ...(cell.font ?? {}) };
    cell.alignment = { vertical: 'top', horizontal: c.align ?? 'left', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
    if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
  });
}

function finishSheet(ws: ExcelJS.Worksheet, headerRow: number, lastRow: number, nCols: number) {
  if (lastRow >= headerRow) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(lastRow, headerRow), column: nCols } };
  }
}

function noteFor(s: SummaryRow): string {
  const notes: string[] = [];
  if (s.approval_status === 'pending') notes.push('NEAPSTIPRINĀTA PRECE');
  if (s.approval_status === 'rejected') notes.push('NORAIDĪTA PRECE');
  if (!s.product_active && s.approval_status === 'approved') notes.push('Neaktīva prece katalogā');
  if (s.equivalent_quantity !== null && s.equivalent_quantity !== undefined && s.equivalent_unit_code) {
    notes.push(`Kopā ≈ ${new Intl.NumberFormat('lv-LV', { maximumFractionDigits: 3 }).format(num(s.equivalent_quantity))} ${s.equivalent_unit_code}`);
  }
  return notes.join('; ');
}

function addReportSheet(wb: ExcelJS.Workbook, name: string, title: string, groupHeader: string, rows: ReportRow[], input: WorkbookInput, tab: string, withCategory = true) {
  const cols: Col[] = [
    { header: groupHeader, width: 30 },
    { header: 'Prece / materiāls', width: 44 },
    ...(withCategory ? [{ header: 'Kategorija', width: 26 } as Col] : []),
    { header: 'Mērvienība', width: 12 },
    { header: 'Daudzums', width: 14, align: 'right' },
    { header: 'Pieteikumu skaits', width: 12, align: 'right' },
  ];
  const { ws, headerRow } = baseSheet(wb, name, title, input, cols, tab);
  let r = headerRow + 1;
  let prevKey: string | null = null;
  let band = false;
  for (const row of rows) {
    if (row.group_key !== prevKey) {
      band = !band;
      prevKey = row.group_key;
    }
    const wr = ws.getRow(r);
    let c = 1;
    wr.getCell(c++).value = row.group_label;
    wr.getCell(c++).value = row.product_name;
    if (withCategory) wr.getCell(c++).value = row.category_name ?? '';
    wr.getCell(c++).value = row.unit_code;
    const q = num(row.total_quantity);
    const qc = wr.getCell(c++);
    qc.value = q;
    qc.numFmt = qtyFormat(row.unit_code, input.countableUnits, q);
    qc.font = { name: FONT, size: 10, bold: true };
    const cnt = wr.getCell(c);
    cnt.value = num(row.request_count);
    cnt.numFmt = '0';
    styleBodyRow(ws, r, cols, band);
    // Atkārtoti uzstādām treknrakstu daudzuma šūnai (styleBodyRow pārraksta alignment/border, ne fontu)
    r++;
  }
  finishSheet(ws, headerRow, r - 1, cols.length);
  return ws;
}

/** Izveido pilnu darbgrāmatu; atgriež .xlsx saturu. */
export async function buildOrderWorkbook(input: WorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Valmieras tehnikums — pieteikumu sistēma';
  wb.created = input.generatedAt;
  wb.title = 'Kopējais pasūtījums';

  // ---- 1. KOPĒJAIS PASŪTĪJUMS ----
  {
    const cols: Col[] = [
      { header: 'Npk.', width: 7, align: 'center' },
      { header: 'Prece / materiāls', width: 46 },
      { header: 'Kategorija', width: 28 },
      { header: 'Mērvienība', width: 13 },
      { header: 'Kopējais daudzums', width: 18, align: 'right' },
      { header: 'Piezīmes', width: 42 },
    ];
    const { ws, headerRow } = baseSheet(wb, SHEET_NAMES.total, 'Kopējais pasūtījums', input, cols, GREEN);
    let r = headerRow + 1;
    input.summary.forEach((s, i) => {
      const wr = ws.getRow(r);
      wr.getCell(1).value = i + 1;
      wr.getCell(2).value = s.product_name;
      wr.getCell(3).value = s.category_name ?? 'Bez kategorijas';
      wr.getCell(4).value = s.unit_code;
      const q = num(s.total_quantity);
      const qc = wr.getCell(5);
      qc.value = q;
      qc.numFmt = qtyFormat(s.unit_code, input.countableUnits, q);
      wr.getCell(6).value = noteFor(s);
      styleBodyRow(ws, r, cols, false);
      qc.font = { name: FONT, size: 11, bold: true, color: { argb: 'FF007A4D' } };
      r++;
    });
    // Kopsavilkuma rinda
    const total = ws.getRow(r);
    total.getCell(2).value = `Pozīciju skaits: ${input.summary.length}`;
    for (let c = 1; c <= cols.length; c++) {
      const cell = total.getCell(c);
      cell.font = { name: FONT, size: 10, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_TINT } };
      cell.border = { top: { style: 'medium', color: { argb: GREEN } } };
    }
    finishSheet(ws, headerRow, r - 1, cols.length);
  }

  // ---- 2. DETALIZĒTI ----
  {
    const cols: Col[] = [
      { header: 'Pedagogs', width: 24 },
      { header: 'Grupa', width: 14 },
      { header: 'Kurss', width: 12 },
      { header: 'Nodarbības tēma', width: 32 },
      { header: 'Datums', width: 12, align: 'center' },
      { header: 'Audzēkņu skaits', width: 11, align: 'right' },
      { header: 'Prece', width: 40 },
      { header: 'Mērvienība', width: 12 },
      { header: 'Daudzums', width: 12, align: 'right' },
      { header: 'Piezīme', width: 30 },
      { header: 'Pieteikuma ID', width: 14 },
      { header: 'Statuss', width: 18 },
    ];
    const { ws, headerRow } = baseSheet(wb, SHEET_NAMES.detail, 'Detalizēti — pa pieteikumu rindām', input, cols, 'FF3F4448');
    let r = headerRow + 1;
    for (const l of input.lines) {
      const wr = ws.getRow(r);
      wr.getCell(1).value = l.teacher_name;
      wr.getCell(2).value = l.group_name ?? '';
      wr.getCell(3).value = l.course_name ?? '';
      wr.getCell(4).value = l.topic;
      const d = isoToDate(l.lesson_date);
      const dc = wr.getCell(5);
      dc.value = d;
      dc.numFmt = 'dd.mm.yyyy';
      const sc = wr.getCell(6);
      sc.value = l.student_count ?? null;
      sc.numFmt = '0';
      wr.getCell(7).value = l.product_name;
      wr.getCell(8).value = l.unit_code;
      const q = num(l.quantity);
      const qc = wr.getCell(9);
      qc.value = q;
      qc.numFmt = qtyFormat(l.unit_code, input.countableUnits, q);
      wr.getCell(10).value = l.item_notes ?? '';
      wr.getCell(11).value = 'P-' + String(l.request_no).padStart(6, '0');
      wr.getCell(12).value = REQUEST_STATUS_LABEL[l.request_status as RequestStatus] ?? l.request_status;
      styleBodyRow(ws, r, cols, false);
      qc.font = { name: FONT, size: 10, bold: true };
      r++;
    }
    finishSheet(ws, headerRow, r - 1, cols.length);
  }

  addReportSheet(wb, SHEET_NAMES.teachers, 'Kopsavilkums pa pedagogiem', 'Pedagogs', input.byTeacher, input, 'FF3F4448');
  addReportSheet(wb, SHEET_NAMES.groups, 'Kopsavilkums pa grupām', 'Grupa', input.byGroup, input, 'FF3F4448');
  addReportSheet(wb, SHEET_NAMES.dates, 'Kopsavilkums pa datumiem', 'Datums', input.byDate, input, 'FF3F4448');
  addReportSheet(wb, SHEET_NAMES.categories, 'Kopsavilkums pa kategorijām', 'Kategorija', input.byCategory, input, 'FF3F4448', false);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
