// Pieteikuma formas tīrā loģika (bez React): validācija, dublikātu atrašana/apvienošana, datu sagatavošana saglabāšanai.
import { compareDecimals, isPositive, parseDecimal, sumDecimals, toInputValue } from '@/lib/decimal';

export interface FormHeader {
  periodId: string;
  courseId: string;
  groupId: string;
  students: string;
  topic: string;
  lessonDate: string;
  studentCount: string;
  notes: string;
}

export interface FormItem {
  /** Rindas identifikators (klienta ģenerēts UUID; tiek saglabāts kā request_items.id) */
  key: string;
  productId: string | null;
  productName: string;
  /** Ievades laukā redzamais teksts (var atšķirties no productName, kamēr lietotājs raksta) */
  query: string;
  unitId: string;
  unitCode: string;
  unitCountable: boolean;
  unitWarn: string | null;
  /** Kataloga (pasūtīšanas) mērvienība — brīdinājumam, ja lietotājs to nomainījis */
  defaultUnitId: string;
  defaultUnitCode: string;
  packageDescription: string | null;
  approval: 'pending' | 'approved' | 'rejected';
  quantity: string;
  notes: string;
}

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  /** Rindas key vai 'header' */
  target: string;
  field?: 'topic' | 'lessonDate' | 'period' | 'product' | 'quantity';
}

export function isEmptyRow(it: FormItem): boolean {
  return !it.productId && it.query.trim() === '' && it.quantity.trim() === '' && it.notes.trim() === '';
}

/** Vai forma satur kaut ko vērtu autosaglabāšanai (lai neveidotu tukšus melnrakstus) */
export function isMeaningful(header: FormHeader, items: FormItem[]): boolean {
  return (
    header.topic.trim() !== '' ||
    header.students.trim() !== '' ||
    header.notes.trim() !== '' ||
    header.lessonDate !== '' ||
    items.some((i) => i.productId !== null)
  );
}

export function findDuplicates(items: FormItem[]): Array<{ productId: string; unitId: string; keys: string[]; name: string }> {
  const groups = new Map<string, { productId: string; unitId: string; keys: string[]; name: string }>();
  for (const it of items) {
    if (!it.productId) continue;
    const id = `${it.productId}|${it.unitId}`;
    const g = groups.get(id) ?? { productId: it.productId, unitId: it.unitId, keys: [], name: it.productName };
    g.keys.push(it.key);
    groups.set(id, g);
  }
  return [...groups.values()].filter((g) => g.keys.length > 1);
}

/** Apvieno dublējošās rindas: daudzumi tiek summēti precīzi, piezīmes savienotas; paliek pirmā rinda. */
export function mergeDuplicateRows(items: FormItem[], productId: string, unitId: string): FormItem[] {
  const same = items.filter((i) => i.productId === productId && i.unitId === unitId);
  if (same.length < 2) return items;
  const first = same[0];
  const quantities = same.map((i) => {
    const p = parseDecimal(i.quantity);
    return p.ok ? p.value : null;
  });
  const anyInvalid = same.some((i, idx) => i.quantity.trim() !== '' && quantities[idx] === null);
  const notes = Array.from(new Set(same.map((i) => i.notes.trim()).filter(Boolean))).join('; ');
  const merged: FormItem = {
    ...first,
    // Ja kāds daudzums nav derīgs skaitlis, neko nesummējam — lietotājam jālabo pašam
    quantity: anyInvalid ? first.quantity : quantities.every((q) => q === null) ? '' : sumDecimals(quantities),
    notes,
  };
  const result: FormItem[] = [];
  for (const it of items) {
    if (it.key === first.key) result.push(merged);
    else if (it.productId === productId && it.unitId === unitId) continue;
    else result.push(it);
  }
  return result;
}

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
  byRow: Map<string, Issue[]>;
}

export function validateForm(header: FormHeader, items: FormItem[]): ValidationResult {
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);

  if (header.topic.trim() === '') {
    add({ severity: 'error', code: 'NO_TOPIC', message: 'Norādiet praktiskās nodarbības tēmu.', target: 'header', field: 'topic' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.lessonDate)) {
    add({ severity: 'error', code: 'NO_DATE', message: 'Norādiet praktiskās nodarbības datumu.', target: 'header', field: 'lessonDate' });
  }
  if (!header.periodId) {
    add({ severity: 'error', code: 'NO_PERIOD', message: 'Izvēlieties pasūtījuma periodu.', target: 'header', field: 'period' });
  }

  const rows = items.filter((i) => !isEmptyRow(i));
  if (rows.length === 0) {
    add({ severity: 'error', code: 'NO_ITEMS', message: 'Pievienojiet vismaz vienu preci.', target: 'header', field: 'product' });
  }

  for (const it of items) {
    if (isEmptyRow(it)) {
      if (items.length > 1) {
        add({ severity: 'warning', code: 'EMPTY_ROW', message: 'Tukša rinda — tā netiks iekļauta pieteikumā.', target: it.key });
      }
      continue;
    }
    if (!it.productId) {
      add({ severity: 'error', code: 'NO_PRODUCT', message: 'Izvēlieties preci no saraksta vai ierosiniet jaunu.', target: it.key, field: 'product' });
    }
    const q = parseDecimal(it.quantity);
    if (!q.ok) {
      const message =
        q.reason === 'empty'
          ? 'Norādiet daudzumu.'
          : q.reason === 'too_precise'
            ? 'Daudzumam drīkst būt ne vairāk kā 3 zīmes aiz komata.'
            : q.reason === 'too_large'
              ? 'Daudzums ir pārāk liels.'
              : 'Daudzums nav derīgs skaitlis (piemēram, 0,5 vai 2).';
      add({ severity: 'error', code: 'BAD_QTY', message, target: it.key, field: 'quantity' });
    } else if (!isPositive(q.value)) {
      add({ severity: 'error', code: 'BAD_QTY', message: 'Daudzumam jābūt lielākam par 0.', target: it.key, field: 'quantity' });
    } else if (it.unitWarn && compareDecimals(q.value, it.unitWarn) > 0) {
      add({
        severity: 'warning',
        code: 'BIG_QTY',
        message: `Neparasti liels daudzums (vairāk nekā ${toInputValue(it.unitWarn)} ${it.unitCode}) — lūdzu, pārbaudiet.`,
        target: it.key,
        field: 'quantity',
      });
    }
    if (it.productId && it.unitId !== it.defaultUnitId) {
      add({
        severity: 'warning',
        code: 'UNIT_DIFFERS',
        message: `Mērvienība atšķiras no kataloga (${it.defaultUnitCode}). Dažādas mērvienības netiek summētas kopā.`,
        target: it.key,
      });
    }
  }

  for (const g of findDuplicates(items)) {
    for (const key of g.keys) {
      add({
        severity: 'warning',
        code: 'DUPLICATE',
        message: `Prece «${g.name}» pieteikumā ievadīta ${g.keys.length} reizes.`,
        target: key,
      });
    }
  }

  const byRow = new Map<string, Issue[]>();
  for (const i of issues) {
    const list = byRow.get(i.target) ?? [];
    list.push(i);
    byRow.set(i.target, list);
  }
  return {
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
    byRow,
  };
}

export interface SavePayload {
  data: {
    period_id: string | null;
    course_id: string | null;
    group_id: string | null;
    students: string;
    topic: string;
    lesson_date: string | null;
    student_count: number | null;
    notes: string;
  };
  items: Array<{ id: string; product_id: string; unit_id: string; quantity: string | null; notes: string | null }>;
}

/** Sagatavo datus serverim: daudzumi kā kanoniski teksti ("0.5"), rindas bez preces netiek sūtītas. */
export function toPayload(header: FormHeader, items: FormItem[]): SavePayload {
  const count = header.studentCount.trim() === '' ? null : Number.parseInt(header.studentCount, 10);
  return {
    data: {
      period_id: header.periodId || null,
      course_id: header.courseId || null,
      group_id: header.groupId || null,
      students: header.students.trim(),
      topic: header.topic.trim(),
      lesson_date: header.lessonDate || null,
      student_count: count !== null && Number.isFinite(count) && count >= 0 ? Math.min(count, 10000) : null,
      notes: header.notes.trim(),
    },
    items: items
      .filter((i) => i.productId)
      .map((i) => {
        const q = parseDecimal(i.quantity);
        return {
          id: i.key,
          product_id: i.productId as string,
          unit_id: i.unitId,
          quantity: q.ok && isPositive(q.value) ? q.value : null,
          notes: i.notes.trim() || null,
        };
      }),
  };
}

export function emptyRow(key: string): FormItem {
  return {
    key,
    productId: null,
    productName: '',
    query: '',
    unitId: '',
    unitCode: '',
    unitCountable: false,
    unitWarn: null,
    defaultUnitId: '',
    defaultUnitCode: '',
    packageDescription: null,
    approval: 'approved',
    quantity: '',
    notes: '',
  };
}
