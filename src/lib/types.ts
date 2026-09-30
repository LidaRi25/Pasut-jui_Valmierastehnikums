import type { ApprovalStatus, AppRole, PeriodStatus, RequestStatus } from '@/lib/labels';

export interface Unit {
  id: string;
  code: string;
  name: string;
  is_countable: boolean;
  warn_quantity: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface Course {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface Group {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Period {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  submission_deadline: string;
  status: PeriodStatus;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string;
  is_active: boolean;
}

/** Preces meklēšanas rezultāts (typeahead) */
export interface ProductHit {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit_id: string;
  unit_code: string;
  base_unit_id: string;
  base_unit_code: string;
  package_description: string | null;
  package_quantity: string | number | null;
  approval_status: ApprovalStatus;
  matched_alias: string | null;
}

/** Pieteikuma rinda redaktorā / skatā */
export interface RequestItemRow {
  id: string;
  position: number;
  product_id: string;
  quantity: string | null;
  unit_id: string;
  notes: string | null;
  product: {
    id: string;
    name: string;
    package_description: string | null;
    approval_status: ApprovalStatus;
    is_active: boolean;
  };
  unit: { id: string; code: string; is_countable: boolean; warn_quantity: string | null };
}

export interface RequestRow {
  id: string;
  request_no: number;
  teacher_id: string;
  period_id: string | null;
  course_id: string | null;
  group_id: string | null;
  students: string | null;
  topic: string;
  lesson_date: string | null;
  student_count: number | null;
  notes: string | null;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
}

export interface SummaryRow {
  product_id: string;
  product_name: string;
  category_id: string | null;
  category_name: string | null;
  approval_status: ApprovalStatus;
  product_active: boolean;
  unit_id: string;
  unit_code: string;
  total_quantity: string | number;
  request_count: number | string;
  teacher_count: number | string;
  group_names: string | null;
  equivalent_quantity: string | number | null;
  equivalent_unit_code: string | null;
}

export interface OrderLine {
  item_id: string;
  request_id: string;
  request_no: number;
  request_status: RequestStatus;
  period_id: string | null;
  teacher_id: string;
  teacher_name: string;
  course_id: string | null;
  course_name: string | null;
  group_id: string | null;
  group_name: string | null;
  students: string | null;
  topic: string;
  lesson_date: string | null;
  student_count: number | null;
  request_notes: string | null;
  product_id: string;
  product_name: string;
  category_id: string | null;
  category_name: string | null;
  approval_status: ApprovalStatus;
  product_active: boolean;
  unit_id: string;
  unit_code: string;
  quantity: string | number;
  item_notes: string | null;
  item_position: number;
}

export interface ReportRow {
  group_key: string;
  group_label: string;
  product_id: string;
  product_name: string;
  category_name: string | null;
  unit_id: string;
  unit_code: string;
  total_quantity: string | number;
  request_count: number | string;
}
