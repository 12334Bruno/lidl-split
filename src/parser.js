import { round2 } from './money.js';

const SEPARATOR_RE = /^[-¦\s]+$/;
const ITEM_RE      = /^(.*)\s+([-\d,]+)\s+([A-C])$/;
const QTY_RE       = /^(.*?)\s+(\d+)\s+x\s+([\d,]+)$/;
const WEIGHT_RE    = /^\s+([\d,]+)\s+kg\s+x\s+([\d,]+)\s+EUR/;
const ARTICLE_RE   = /^(.*?)-(\d{6,})$/;
const DISCOUNT_KW  = ['korting', 'verlaagd', 'emballage', 'statiegeld'];

function pf(s) { return parseFloat(s.replace(',', '.')); }
function isSep(line) { return SEPARATOR_RE.test(line); }

function splitSections(lines) {
  const omsch = lines.findIndex(l => l.includes('OMSCHRIJVING'));
  if (omsch === -1) throw new Error('Cannot find OMSCHRIJVING header — is this a Lidl receipt?');
  const aantal = lines.findIndex(l => l.trim().startsWith('Aantal'));
  if (aantal === -1) throw new Error('Cannot find end of items block (missing "Aantal" line).');
  let sep = null;
  for (let j = aantal - 1; j > omsch; j--) { if (isSep(lines[j])) { sep = j; break; } }
  if (sep === null) throw new Error('Cannot find separator line between items and totals.');
  return { header: lines.slice(0, omsch), itemLines: lines.slice(omsch + 1, sep), footer: lines.slice(sep) };
}

function parseHeader(lines) { return lines.map(l => l.trim()).filter(Boolean)[0] || ''; }

function parseDate(lines) {
  for (const l of lines) { const m = l.match(/(\d{2}-\d{2}-\d{4})/); if (m) return m[1]; }
  return null;
}

export function parseItemLine(line) {
  let m = line.match(ITEM_RE);
  if (m) {
    const nameRaw = m[1].trim();
    const item = { type: 'item', vat_category: m[3], price: pf(m[2]) };
    const q = nameRaw.match(QTY_RE);
    if (q) { item.name = q[1].trim(); item.quantity = parseInt(q[2]); item.unit_price = pf(q[3]); }
    else   { item.name = nameRaw; item.quantity = 1; item.unit_price = item.price; }
    const a = item.name.match(ARTICLE_RE);
    if (a) item.name = a[1].trim();
    return item;
  }
  m = line.match(/^(.*?)\s+([-\d,]+)\s*$/);
  if (m) {
    const name = m[1].trim(), amount = pf(m[2]);
    const isReturn = name.startsWith('[X]');
    const clean = isReturn ? name.slice(3).trim() : name;
    const isDkw = DISCOUNT_KW.some(kw => clean.toLowerCase().includes(kw));
    if (amount < 0 || isDkw) {
      if (amount > 0 && (clean.toLowerCase().includes('statiegeld') || clean.toLowerCase().includes('emballage')))
        return { type: 'item', name: clean, quantity: 1, price: amount, unit_price: amount, vat_category: null };
      return { type: isReturn ? 'return' : 'discount', name: clean, amount };
    }
  }
  return null;
}

function parseItemsBlock(lines) {
  const items = []; let pending = null;
  for (const line of lines) {
    if (!line.trim() || isSep(line)) continue;
    const w = line.match(WEIGHT_RE);
    if (w) {
      if (pending) { delete pending.unit_price; pending.weight_kg = pf(w[1]); pending.unit_price_per_kg = pf(w[2]); }
      continue;
    }
    if (pending) items.push(pending);
    pending = parseItemLine(line.trim());
  }
  if (pending) items.push(pending);
  return items;
}

export function parseLidlText(text) {
  const lines = text.split('\n');
  const { header, itemLines, footer } = splitSections(lines);
  const allLines  = parseItemsBlock(itemLines);
  const items     = allLines.filter(r => r.type === 'item');
  const discounts = allLines.filter(r => r.type !== 'item');
  for (const item of items) { item.paid_price = item.price; delete item.type; }
  const total_gross    = round2(items.reduce((s, i) => s + i.price, 0));
  const total_discount = round2(discounts.reduce((s, d) => s + (d.amount || 0), 0));
  const total_net      = round2(total_gross + total_discount);
  return {
    store: parseHeader(header), date: parseDate(footer),
    total_gross, total_net,
    discounts: discounts.map(d => ({ name: d.name, amount: d.amount })),
    items,
  };
}