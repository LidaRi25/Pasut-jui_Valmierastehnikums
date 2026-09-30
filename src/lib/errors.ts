// Datubāzes kļūdu kodu (VT_*) tulkošana latviešu valodā. Gala lietotājam nekad netiek rādīti tehniski teksti.

export interface DbErrorLike {
  message?: string;
  details?: string | null;
  code?: string;
  hint?: string | null;
}

const SUBMIT_DETAIL: Record<string, string> = {
  NO_TOPIC: 'Norādiet praktiskās nodarbības tēmu.',
  NO_DATE: 'Norādiet praktiskās nodarbības datumu.',
  NO_PERIOD: 'Izvēlieties pasūtījuma periodu.',
  PERIOD_CLOSED: 'Izvēlētais periods ir slēgts vai iesniegšanas termiņš ir beidzies.',
  NO_ITEMS: 'Pievienojiet vismaz vienu preci.',
  BAD_QTY: 'Visām precēm jānorāda daudzums, kas lielāks par 0.',
};

const CODE_MESSAGE: Record<string, string> = {
  VT_FORBIDDEN: 'Jums nav tiesību veikt šo darbību.',
  VT_FORBIDDEN_STATUS: 'Šādu statusa maiņu veikt nav atļauts.',
  VT_NOT_FOUND: 'Ieraksts nav atrasts.',
  VT_LOCKED: 'Šo pieteikumu vairs nevar labot — iesniegšanas termiņš ir beidzies vai pieteikuma statuss ir mainīts.',
  VT_PERIOD_CLOSED: 'Izvēlētais periods ir slēgts vai iesniegšanas termiņš ir beidzies.',
  VT_PRODUCT_INACTIVE: 'Prece vairs nav pieejama izvēlei. Izvēlieties citu preci.',
  VT_DUPLICATE_NAME: 'Šāda prece jau ir katalogā vai jau ir ierosināta. Meklējiet to katalogā.',
  VT_ALREADY_SUBMITTED: 'Pieteikums jau ir iesniegts.',
  VT_ALREADY_RESOLVED: 'Šis ierosinājums jau ir izskatīts.',
  VT_LAST_SYSADMIN: 'Nevar noņemt vai deaktivizēt pēdējo sistēmas administratoru.',
  VT_INVALID: 'Ievadītie dati nav derīgi.',
  VT_INVALID_TRANSITION: 'Šādu statusa maiņu veikt nav atļauts.',
  VT_CONFLICT: 'Pieteikums starplaikā ir mainīts (citā logā vai ar citu lietotāju). Atsvaidziniet lapu, lai redzētu jaunāko versiju.',
  VT_BAD_QTY: 'Daudzumam jābūt lielākam par 0.',
  VT_AUDIT_IMMUTABLE: 'Audita vēsturi nedrīkst mainīt.',
};

export const GENERIC_ERROR = 'Radās neparedzēta kļūda. Lūdzu, mēģiniet vēlreiz.';

export function dbErrorMessage(error: DbErrorLike | null | undefined): string {
  if (!error) return GENERIC_ERROR;
  const message = error.message ?? '';
  if (message.includes('VT_SUBMIT_INVALID')) {
    const codes = (error.details ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    const lines = codes.map((c) => SUBMIT_DETAIL[c]).filter(Boolean);
    return lines.length ? lines.join(' ') : 'Pieteikumu nevar iesniegt — pārbaudiet ievadītos datus.';
  }
  if (message.includes('VT_DUPLICATE_ALIAS')) {
    return error.details
      ? `Šāds nosaukums jau ir sinonīms precei «${error.details}». Izmantojiet to.`
      : 'Šāds nosaukums jau ir sinonīms esošai precei.';
  }
  // Precīza koda izgūšana (VT_FORBIDDEN nedrīkst "nosegt" VT_FORBIDDEN_STATUS)
  const code = /VT_[A-Z_]+/.exec(message)?.[0];
  if (code && CODE_MESSAGE[code]) return CODE_MESSAGE[code];
  switch (error.code) {
    case '23505':
      return 'Šāds ieraksts jau eksistē.';
    case '23503':
      return 'Ierakstu nevar mainīt vai dzēst, jo tas tiek izmantots citur.';
    case '23514':
    case '22P02':
    case '22007':
    case '22003':
      return 'Ievadītā vērtība nav derīga.';
    case '42501':
      return 'Jums nav tiesību veikt šo darbību.';
    default:
      return GENERIC_ERROR;
  }
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function fail(error: DbErrorLike | string | null | undefined): { ok: false; error: string } {
  if (typeof error === 'string') return { ok: false, error };
  if (error && !(error.message ?? '').includes('VT_') && error.code && !/^(23|22|42501)/.test(error.code)) {
    console.error('[db]', error.code, error.message);
  }
  return { ok: false, error: dbErrorMessage(error) };
}
