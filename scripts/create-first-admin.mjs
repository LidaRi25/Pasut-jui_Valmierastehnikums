#!/usr/bin/env node
// Izveido pirmo sistēmas administratoru.
//   node --env-file=.env.local scripts/create-first-admin.mjs --email vards@valmierastehnikums.lv --name "Vārds Uzvārds" [--password "..."] [--promote]
// --promote nepieciešams tikai tad, ja konts jau eksistē un to vēlaties paaugstināt par sistēmas administratoru.
// Ja parole nav norādīta, tiek ģenerēta un izdrukāta (nomainiet to pēc pirmās pieteikšanās sadaļā "Profils").
import { arg, ensureUser, randomPassword, serviceClient, setRole } from './lib.mjs';

const email = arg('email');
const name = arg('name');
if (!email || !name) {
  console.error('Lietošana: create-first-admin.mjs --email <e-pasts> --name "<Vārds Uzvārds>" [--password <parole>]');
  process.exit(1);
}
const password = arg('password') ?? randomPassword();
if (password.length < 8) {
  console.error('Parolei jābūt vismaz 8 simbolus garai.');
  process.exit(1);
}

const sb = serviceClient();
const user = await ensureUser(sb, { email, fullName: name, password });
if (!user.created && !process.argv.includes('--promote')) {
  console.error(`Lietotājs ${email} jau eksistē. Lai to paaugstinātu par sistēmas administratoru, palaidiet vēlreiz ar --promote.`);
  process.exit(1);
}
await setRole(sb, user.id, 'sysadmin');
console.log(user.created ? `Lietotājs ${email} izveidots.` : `Lietotājs ${email} jau eksistēja.`);
console.log('Loma: Sistēmas administrators.');
if (user.created) console.log(`Pagaidu parole: ${password}`);
