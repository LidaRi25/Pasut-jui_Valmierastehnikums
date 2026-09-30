#!/usr/bin/env node
// DEMO dati: 3 pedagogi, pasūtītājs, sistēmas administrators, periodi un vairāki pieteikumi
// (t.sk. specifikācijas paraugpieteikums: Sanita Reinfelde, Baltic VET Skills 2026).
// NEPALAIST produkcijas datubāzē ar īstiem lietotājiem — izveido demo kontus ar zināmu paroli.
//   node --env-file=.env.local scripts/seed-demo.mjs --yes [--password "..."]
import { arg, ensureUser, randomPassword, serviceClient, setRole } from './lib.mjs';

if (!process.argv.includes('--yes')) {
  console.error('Šis skripts izveido DEMO lietotājus un pieteikumus. Apstipriniet ar --yes (nelietot produkcijā!).');
  process.exit(1);
}
const password = arg('password') ?? process.env.DEMO_PASSWORD ?? randomPassword();
const sb = serviceClient();

const people = [
  { email: 'sysadmin@vt.test', name: 'Sistēmas Administrators', role: 'sysadmin' },
  { email: 'pasutitajs@vt.test', name: 'Pasūtītājs Demo', role: 'admin' },
  { email: 'sanita.reinfelde@vt.test', name: 'Sanita Reinfelde', role: 'teacher' },
  { email: 'janis.berzins@vt.test', name: 'Jānis Bērziņš', role: 'teacher' },
  { email: 'ilze.kalnina@vt.test', name: 'Ilze Kalniņa', role: 'teacher' },
];
const ids = {};
for (const p of people) {
  const u = await ensureUser(sb, { email: p.email, fullName: p.name, password });
  await setRole(sb, u.id, p.role);
  ids[p.email] = u.id;
  console.log(`${u.created ? 'izveidots' : 'jau bija  '}  ${p.email}  (${p.role})`);
}

const one = async (q) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

// ---------- Periodi ----------
async function ensurePeriod(name, start, end, deadline, status = 'open') {
  const found = await one(sb.from('order_periods').select('id').eq('name', name).maybeSingle());
  if (found) return found.id;
  return (await one(sb.from('order_periods').insert({ name, start_date: start, end_date: end, submission_deadline: deadline, status }).select('id').single())).id;
}
const p1 = await ensurePeriod('05.10.2026.–09.10.2026.', '2026-10-05', '2026-10-09', '2026-10-02T14:00:00Z');
const p2 = await ensurePeriod('26.10.2026.–30.10.2026.', '2026-10-26', '2026-10-30', '2026-10-23T14:00:00Z');

// ---------- Atsauces ----------
const groups = Object.fromEntries((await one(sb.from('groups').select('id, name'))).map((g) => [g.name, g.id]));
const courses = Object.fromEntries((await one(sb.from('courses').select('id, name'))).map((c) => [c.name, c.id]));
const products = await one(sb.from('products').select('id, name, order_unit_id').eq('is_active', true));
const aliases = await one(sb.from('product_aliases').select('alias, product_id'));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
function findProduct(name) {
  const n = norm(name);
  const direct = products.find((p) => norm(p.name) === n);
  if (direct) return direct;
  const a = aliases.find((x) => norm(x.alias) === n);
  if (a) return products.find((p) => p.id === a.product_id);
  throw new Error(`Katalogā nav preces «${name}»`);
}

async function createRequest({ teacher, period, course, group, students, topic, date, count, items }) {
  const teacherId = ids[teacher];
  const exists = await one(sb.from('requests').select('id').eq('teacher_id', teacherId).eq('topic', topic).eq('lesson_date', date).maybeSingle());
  if (exists) {
    console.log(`pieteikums jau eksistē: ${topic} (${date})`);
    return exists.id;
  }
  const req = await one(
    sb.from('requests').insert({
      teacher_id: teacherId, period_id: period, course_id: courses[course] ?? null, group_id: groups[group] ?? null,
      students: students ?? null, topic, lesson_date: date, student_count: count, status: 'draft',
    }).select('id').single(),
  );
  const rows = items.map(([name, qty, notes], i) => {
    const p = findProduct(name);
    return { request_id: req.id, position: i + 1, product_id: p.id, quantity: qty, unit_id: p.order_unit_id, notes: notes ?? null };
  });
  await one(sb.from('request_items').insert(rows));
  await one(sb.from('requests').update({ status: 'submitted' }).eq('id', req.id));
  console.log(`pieteikums izveidots: ${topic} (${date}), ${rows.length} rindas`);
  return req.id;
}

// Specifikācijas paraugpieteikums (§28)
await createRequest({
  teacher: 'sanita.reinfelde@vt.test', period: p2, course: '4. kurss', group: '6. grupa', students: 'Anete Stabiņa',
  topic: 'Baltic VET Skills 2026', date: '2026-10-29', count: 1,
  items: [
    ['Bietes tvaicētas', '0.5'], ['Rudzu maize nesagriezta', '1'], ['Baltmaize', '2'], ['Šprotes eļļā', '0.2'],
    ['Dilles', '0.1'], ['Sakura komplekts', '4'], ['Saldais krējums', '0.5'], ['Tītara fileja', '1'],
    ['Skābais krējums 25%', '0.2'], ['Apelsīni sulai', '1'],
  ],
});

// Vairāki pieteikumi vienam periodam; "Bietes tvaicētas" trīs pieteikumos (0,5 + 2 + 1,5 = 4,0 kg)
await createRequest({
  teacher: 'janis.berzins@vt.test', period: p2, course: '2. kurss', group: '2. grupa', topic: 'Aukstās zupas un salāti', date: '2026-10-27', count: 14,
  items: [['Bietes tvaicētas', '2'], ['Krējums skābais 25%', '1.5'], ['Dilles svaigas', '0.3'], ['Kartupeļi', '5'], ['Olas', '30'], ['Sviests 1×0,2 kg', '3']],
});
await createRequest({
  teacher: 'ilze.kalnina@vt.test', period: p2, course: '3. kurss', group: '3. grupa', topic: 'Sātīgi otrie ēdieni', date: '2026-10-28', count: 12,
  items: [['Bietes tvaicētas', '1.5'], ['Cūkgaļa maltā', '4'], ['Sīpoli', '2'], ['Burkāni', '3'], ['Kartupeļi', '8'], ['Sviests 1×0,5 kg', '2'], ['Piens 2,5% 1×1 L', '12']],
});
await createRequest({
  teacher: 'sanita.reinfelde@vt.test', period: p2, course: '4. kurss', group: '1. grupa', topic: 'Konditorejas pamati', date: '2026-10-30', count: 10,
  items: [['Kviešu milti 405. tips', '6'], ['Cukurs', '3'], ['Pūdercukurs', '0.5'], ['Olas', '40'], ['Sviests 1×0,5 kg', '4'], ['Vanilīna/Vanilas cukurs', '50'], ['Raugs sausais', '100']],
});
// Otrs periods
await createRequest({
  teacher: 'janis.berzins@vt.test', period: p1, course: '1. kurss', group: '1. grupa', topic: 'Zupu pamati', date: '2026-10-06', count: 15,
  items: [['Burkāni', '4'], ['Sīpoli', '3'], ['Ķiploki', '0.3'], ['Selerijas sakne', '1']],
});

console.log('\nGatavs. Pieteikšanās dati (visiem kontiem viena parole):');
console.log(`  parole: ${password}`);
for (const p of people) console.log(`  ${p.email.padEnd(28)} ${p.role}`);
