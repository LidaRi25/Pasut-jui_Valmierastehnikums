import { describe, expect, it } from 'vitest';
import { fetchAll } from '@/lib/supabase/fetch-all';

// Imitē PostgREST ar servera max_rows ierobežojumu (var būt mazāks par API_PAGE)
function fakeTable(total: number, serverMax: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const make = () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to]);
      return { data: rows.slice(from, Math.min(to + 1, from + serverMax)), error: null };
    },
  });
  return { make, calls };
}

describe('fetchAll lapošana', () => {
  it('atgriež visas rindas, arī ja servera max_rows ir mazāks par lapas izmēru', async () => {
    const { make } = fakeTable(2500, 400);
    const all = await fetchAll<number>(make);
    expect(all).toHaveLength(2500);
    expect(all[0]).toBe(0);
    expect(all[2499]).toBe(2499);
  });

  it('darbojas ar tukšu rezultātu un precīzu lapas izmēra daudzkārtni', async () => {
    expect(await fetchAll<number>(fakeTable(0, 1000).make)).toEqual([]);
    expect(await fetchAll<number>(fakeTable(2000, 1000).make)).toHaveLength(2000);
  });

  it('nekad kluši neapcērp: pārsniedzot robežu met kļūdu', async () => {
    await expect(fetchAll<number>(fakeTable(3000, 1000).make, 2000)).rejects.toThrow(/robežu/);
    // precīzi robežas apjoms ir atļauts
    expect(await fetchAll<number>(fakeTable(2000, 1000).make, 2000)).toHaveLength(2000);
  });

  it('pārsūta PostgREST kļūdu', async () => {
    const make = () => ({ range: async () => ({ data: null, error: { message: 'boom', code: '57014', details: null } }) });
    await expect(fetchAll<number>(make)).rejects.toMatchObject({ message: 'boom', code: '57014' });
  });
});
