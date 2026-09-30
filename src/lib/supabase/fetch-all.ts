// Supabase API atgriež ne vairāk kā max_rows (pēc noklusējuma 1000) rindu vienā pieprasījumā.
// Šis palīgs nolasa visas lapas, lai kopsummas un eksports nekad netiktu klusi apcirsti.

export const API_PAGE = 1000;

interface Rangeable<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string; code?: string; details?: string | null } | null }>;
}

export async function fetchAll<T>(make: () => Rangeable<T>, maxRows = 200_000): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += API_PAGE) {
    if (from >= maxRows) {
      // Nekad neapcērpam datus kluši — labāk skaidra kļūda nekā nepilns eksports/kopsumma
      throw new Error(`Rezultāts pārsniedz ${maxRows} rindu robežu; precizējiet filtrus.`);
    }
    const { data, error } = await make().range(from, from + API_PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code, details: error.details });
    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < API_PAGE) break;
  }
  return all;
}
