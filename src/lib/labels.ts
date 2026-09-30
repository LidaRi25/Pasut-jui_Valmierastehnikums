// Latviešu valodas nosaukumi uzskaitījumiem (statusi, lomas u.c.)

export type RequestStatus = 'draft' | 'submitted' | 'approved' | 'included' | 'ordered' | 'cancelled';
export type PeriodStatus = 'open' | 'closed' | 'collecting' | 'ordered' | 'archived';
export type AppRole = 'teacher' | 'admin' | 'sysadmin';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  draft: 'Melnraksts',
  submitted: 'Iesniegts',
  approved: 'Apstiprināts',
  included: 'Iekļauts pasūtījumā',
  ordered: 'Pasūtīts',
  cancelled: 'Atcelts',
};

export const REQUEST_STATUSES = Object.keys(REQUEST_STATUS_LABEL) as RequestStatus[];

/** Statusi, kas pēc noklusējuma tiek iekļauti kopējā pasūtījumā (bez melnrakstiem un atceltajiem) */
export const ORDER_STATUSES: RequestStatus[] = ['submitted', 'approved', 'included', 'ordered'];

export const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = {
  open: 'Atvērts',
  closed: 'Slēgts',
  collecting: 'Apkopošanā',
  ordered: 'Pasūtīts',
  archived: 'Arhivēts',
};
export const PERIOD_STATUSES = Object.keys(PERIOD_STATUS_LABEL) as PeriodStatus[];

export const ROLE_LABEL: Record<AppRole, string> = {
  teacher: 'Pedagogs',
  admin: 'Pasūtītājs / administrators',
  sysadmin: 'Sistēmas administrators',
};

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  pending: 'Neapstiprināta',
  approved: 'Apstiprināta',
  rejected: 'Noraidīta',
};

export function isAdminRole(role: AppRole | null | undefined): boolean {
  return role === 'admin' || role === 'sysadmin';
}

/** CSS klase statusa nozīmītei */
export function requestStatusTone(status: RequestStatus): 'neutral' | 'green' | 'dark' | 'muted' | 'warn' {
  switch (status) {
    case 'draft':
      return 'muted';
    case 'submitted':
      return 'neutral';
    case 'approved':
      return 'green';
    case 'included':
      return 'green';
    case 'ordered':
      return 'dark';
    case 'cancelled':
      return 'warn';
  }
}

export function periodStatusTone(status: PeriodStatus): 'neutral' | 'green' | 'dark' | 'muted' | 'warn' {
  switch (status) {
    case 'open':
      return 'green';
    case 'collecting':
      return 'neutral';
    case 'ordered':
      return 'dark';
    case 'closed':
      return 'warn';
    case 'archived':
      return 'muted';
  }
}
