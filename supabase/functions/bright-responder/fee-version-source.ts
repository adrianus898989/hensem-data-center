// Source evidence from the exact normalized-rate fetch. Never infer edit time.
export type EffectiveEvidence = { effectiveFrom: string | null; currency: string | null; state: string; effectiveCell: string | null; currencyCell: string | null };
export function feeColumnName(index: number): string {
  let value = index + 1, out = '';
  while (value > 0) { value--; out = String.fromCharCode(65 + value % 26) + out; value = Math.floor(value / 26); }
  return out;
}
export function explicitEffectiveTime(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2200 || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCFullYear() !== Number(m[1]) || date.getUTCMonth() + 1 !== Number(m[2]) || date.getUTCDate() !== Number(m[3])) return null;
  if (m[7] !== 'Z' && (Number(m[7].slice(1,3)) > 14 || Number(m[7].slice(4)) > 59 || (Number(m[7].slice(1,3)) === 14 && Number(m[7].slice(4)) !== 0))) return null;
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}
export function rateEffectiveEvidence(values: string[][]): { values: string[][]; rows: Map<number, EffectiveEvidence> } {
  const clean = values.map(row => [...row]);
  // Fee sheets have one primary header within the first five rows. A column
  // named on a later business row cannot create publication metadata.
  const headers: {row:number;col:number;kind:'effective'|'currency'}[] = [];
  values.slice(0,5).forEach((row, r) => row.forEach((cell, c) => {
    const text = String(cell ?? '').trim();
    if (text === '生效时间') headers.push({row:r,col:c,kind:'effective'});
    if (text === '币种') headers.push({row:r,col:c,kind:'currency'});
  }));
  const effective = headers.filter(x => x.kind === 'effective'), currencies = headers.filter(x => x.kind === 'currency');
  // Blank rather than splice: existing status matrix source-column coordinates
  // remain exact even if the owner inserts these columns before platforms.
  for (const h of headers) for (const row of clean) if (h.col < row.length) row[h.col] = '';
  const rows = new Map<number, EffectiveEvidence>();
  values.forEach((row,r) => {
    const h = effective.length === 1 ? effective[0] : null;
    const raw = h && r > h.row ? String(row[h.col] ?? '').trim() : '';
    const effectiveFrom = explicitEffectiveTime(raw);
    const c = currencies.length === 1 ? currencies[0] : null;
    const rawCurrency = c && r > c.row ? String(row[c.col] ?? '').trim().toUpperCase() : '';
    rows.set(r + 1, { effectiveFrom, currency: /^[A-Z]{3,6}$/.test(rawCurrency) ? rawCurrency : null,
      state: effective.length > 1 ? 'ambiguous_effective_column' : !h ? 'missing_effective_column' : !raw ? 'missing_effective_time' : !effectiveFrom ? 'invalid_effective_time' : currencies.length > 1 ? 'ambiguous_currency_column' : rawCurrency && !/^[A-Z]{3,6}$/.test(rawCurrency) ? 'invalid_currency' : 'ready',
      effectiveCell: h ? feeColumnName(h.col) + (r+1) : null, currencyCell: c ? feeColumnName(c.col) + (r+1) : null });
  });
  return {values:clean,rows};
}
