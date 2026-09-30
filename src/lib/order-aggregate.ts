// Pasūtījuma kopsavilkumu aprēķins no order_lines rindām (precīza BigInt aritmētika).
// Izmanto Excel eksports: visas lapas tiek aprēķinātas no VIENA datu momentuzņēmuma; tie paši noteikumi kā SQL funkcijām
// get_order_summary / get_order_report (pārbauda tests tests/db/aggregate-parity.test.ts).
import { fromScaled, numStr, toScaled } from '@/lib/decimal';
import type { OrderLine, ReportRow, SummaryRow } from '@/lib/types';

const cmp = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').localeCompare(b ?? '', 'lv');

/** Apkopojums pa precēm: grupē pēc product_id UN mērvienības (dažādas mērvienības netiek summētas kopā). */
export function summarizeLines(lines: OrderLine[], unitCodeById: Map<string, string>): SummaryRow[] {
  interface Acc {
    line: OrderLine;
    total: bigint;
    requests: Set<string>;
    teachers: Set<string>;
    groups: Set<string>;
  }
  const map = new Map<string, Acc>();
  for (const l of lines) {
    const key = `${l.product_id}|${l.unit_id}`;
    let acc = map.get(key);
    if (!acc) {
      acc = { line: l, total: 0n, requests: new Set(), teachers: new Set(), groups: new Set() };
      map.set(key, acc);
    }
    acc.total += toScaled(l.quantity);
    acc.requests.add(l.request_id);
    acc.teachers.add(l.teacher_id);
    if (l.group_name) acc.groups.add(l.group_name);
  }
  const rows = [...map.values()].map((a): SummaryRow & { _sort: number | null } => {
    const l = a.line;
    const pkg = numStr(l.package_quantity);
    const hasEquivalent = l.unit_id === l.order_unit_id && pkg !== null && l.base_unit_id !== l.order_unit_id;
    // total × package_quantity, noapaļots līdz 3 zīmēm (kā SQL round(…, 3)); abi ir ×1000, tāpēc reizinājums ir ×10^6
    const equivalent = hasEquivalent ? fromScaled((a.total * toScaled(pkg as string) + 500n) / 1000n) : null;
    return {
      product_id: l.product_id,
      product_name: l.product_name,
      category_id: l.category_id,
      category_name: l.category_name,
      approval_status: l.approval_status,
      product_active: l.product_active,
      unit_id: l.unit_id,
      unit_code: l.unit_code,
      total_quantity: fromScaled(a.total),
      request_count: a.requests.size,
      teacher_count: a.teachers.size,
      group_names: a.groups.size ? [...a.groups].sort(cmp).join(', ') : null,
      equivalent_quantity: equivalent,
      equivalent_unit_code: hasEquivalent ? (unitCodeById.get(l.base_unit_id) ?? null) : null,
      _sort: l.category_sort,
    };
  });
  rows.sort((x, y) => {
    if ((x._sort === null) !== (y._sort === null)) return x._sort === null ? 1 : -1;
    if (x._sort !== y._sort) return (x._sort ?? 0) - (y._sort ?? 0);
    if ((x.category_name === null) !== (y.category_name === null)) return x.category_name === null ? 1 : -1;
    return cmp(x.category_name, y.category_name) || cmp(x.product_name, y.product_name) || cmp(x.product_id, y.product_id) || cmp(x.unit_code, y.unit_code);
  });
  return rows.map(({ _sort, ...r }) => {
    void _sort;
    return r;
  });
}

export type ReportDimension = 'teacher' | 'group' | 'course' | 'date' | 'category';

function dimensionOf(l: OrderLine, d: ReportDimension): { key: string; label: string } {
  switch (d) {
    case 'teacher':
      return { key: l.teacher_id, label: l.teacher_name };
    case 'group':
      return { key: l.group_id ?? '', label: l.group_name ?? 'Nenorādīta' };
    case 'course':
      return { key: l.course_id ?? '', label: l.course_name ?? 'Nenorādīts' };
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(l.lesson_date ?? '');
      return { key: l.lesson_date ?? '', label: m ? `${m[3]}.${m[2]}.${m[1]}` : 'Nenorādīts' };
    }
    case 'category':
      return { key: l.category_id ?? '', label: l.category_name ?? 'Bez kategorijas' };
  }
}

/** Atskaite pa pedagogiem / grupām / kursiem / datumiem / kategorijām (kopsummas pa precēm katrā griezumā). */
export function reportLines(lines: OrderLine[], dimension: ReportDimension): ReportRow[] {
  interface Acc {
    row: ReportRow;
    total: bigint;
    requests: Set<string>;
    sortKey: string;
  }
  const map = new Map<string, Acc>();
  for (const l of lines) {
    const dim = dimensionOf(l, dimension);
    const key = `${dim.key}|${dim.label}|${l.product_id}|${l.unit_id}`;
    let acc = map.get(key);
    if (!acc) {
      acc = {
        row: {
          group_key: dim.key,
          group_label: dim.label,
          product_id: l.product_id,
          product_name: l.product_name,
          category_name: l.category_name,
          unit_id: l.unit_id,
          unit_code: l.unit_code,
          total_quantity: '0',
          request_count: 0,
        },
        total: 0n,
        requests: new Set(),
        sortKey: dimension === 'date' ? (l.lesson_date ?? '9999') : dim.label.toLowerCase(),
      };
      map.set(key, acc);
    }
    acc.total += toScaled(l.quantity);
    acc.requests.add(l.request_id);
  }
  return [...map.values()]
    .sort((x, y) => cmp(x.sortKey, y.sortKey) || cmp(x.row.group_key, y.row.group_key) || cmp(x.row.product_name, y.row.product_name) || cmp(x.row.product_id, y.row.product_id) || cmp(x.row.unit_code, y.row.unit_code))
    .map((a) => ({ ...a.row, total_quantity: fromScaled(a.total), request_count: a.requests.size }));
}
