// Supabase API atgriež ne vairāk kā max_rows (pēc noklusējuma 1000) rindu vienā pieprasījumā.
// Šis palīgs nolasa visas lapas, lai kopsummas un eksports nekad netiktu klusi apcirsti.

export const API_PAGE = 1000;

interface Rangeable<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string; code?: string; details?: string | null } | null }>;
}

export async function fetchAll<T>(make: () => Rangeable<T>, maxRows = 200_000): Promise<T[]> {
  const all: T[] = [];
  // Lapojam līdz tukšai lapai un virzāmies par faktiski saņemto rindu skaitu — arī tad, ja servera max_rows ir mazāks par API_PAGE
  for (;;) {
    const from = all.length;
    const { data, error } = await make().range(from, from + API_PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code, details: error.details });
    const chunk = data ?? [];
    if (chunk.length === 0) break;
    all.push(...chunk);
    // Nekad neapcērpam datus kluši — labāk skaidra kļūda nekā nepilns eksports/kopsumma
    if (all.length > maxRows) throw new Error(`Rezultāts pārsniedz ${maxRows} rindu robežu; precizējiet filtrus.`);
  }
  return all;
}
