/**
 * Pieņem tikai iekšēju relatīvu ceļu (aizsardzība pret atvērto novirzīšanu).
 * Noraida "//host", "/\host", "http://…", ceļus ar atpakaļējo slīpsvītru vai vadības simboliem.
 */
export function safeInternalPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (!/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#\[\]]*$/.test(value)) return fallback;
  if (value.startsWith('//') || value.includes('\\')) return fallback;
  // pārbaudām, ka pēc parsēšanas paliek tajā pašā izcelsmē
  try {
    const u = new URL(value, 'http://internal.invalid');
    if (u.origin !== 'http://internal.invalid') return fallback;
  } catch {
    return fallback;
  }
  return value;
}
