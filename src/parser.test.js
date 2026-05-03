import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLidlText, parseItemLine } from './parser.js';

const LIDL_DUMP = readFileSync('./fixtures/2026-03-16-lidl-dump.txt', 'utf8');

describe('parseItemLine', () => {
  test('parses a plain single item', () => {
    const result = parseItemLine('Spaghetti HWG                       0,95 B');
    assert.equal(result.type, 'item');
    assert.equal(result.name, 'Spaghetti HWG');
    assert.equal(result.price, 0.95);
    assert.equal(result.quantity, 1);
    assert.equal(result.unit_price, 0.95);
    assert.equal(result.vat_category, 'B');
  });

  test('parses a quantity item', () => {
    const result = parseItemLine('Bio gembershot       4 x 0,99       3,96 B');
    assert.equal(result.name, 'Bio gembershot');
    assert.equal(result.quantity, 4);
    assert.equal(result.unit_price, 0.99);
    assert.equal(result.price, 3.96);
    assert.equal(result.vat_category, 'B');
  });

  test('strips article number suffix from item name', () => {
    const result = parseItemLine('Föhn-0493480                        9,99 C');
    assert.equal(result.name, 'Föhn');
    assert.equal(result.price, 9.99);
  });

  test('parses a discount line (negative amount)', () => {
    const result = parseItemLine('     Lidl Plus korting             -0,40');
    assert.equal(result.type, 'discount');
    assert.equal(result.name, 'Lidl Plus korting');
    assert.equal(result.amount, -0.40);
  });

  test('parses a keyword-flagged discount (In prijs verlaagd)', () => {
    const result = parseItemLine('In prijs verlaagd                  -0,40');
    assert.equal(result.type, 'discount');
    assert.equal(result.name, 'In prijs verlaagd');
    assert.equal(result.amount, -0.40);
  });

  test('parses a return line ([X] prefix)', () => {
    const result = parseItemLine('[X] Emballage                      -6,40');
    assert.equal(result.type, 'return');
    assert.equal(result.name, 'Emballage');
    assert.equal(result.amount, -6.40);
  });

  test('returns null for unrecognised / non-item lines', () => {
    assert.equal(parseItemLine('OMSCHRIJVING                         EUR'), null);
    assert.equal(parseItemLine(''), null);
    assert.equal(parseItemLine('   '), null);
  });

  test('item with vat category A is parsed as a regular item', () => {
    // Statiegeld (deposit charge) is a positive item, not a discount
    const result = parseItemLine('Blik los statiegeld  4 x 0,15       0,60 A');
    assert.equal(result.type, 'item');
    assert.equal(result.name, 'Blik los statiegeld');
    assert.equal(result.quantity, 4);
    assert.equal(result.unit_price, 0.15);
    assert.equal(result.price, 0.60);
    assert.equal(result.vat_category, 'A');
  });
});

describe('parseLidlText — full receipt', () => {
  let receipt;
  test('parses without throwing', () => {
    receipt = parseLidlText(LIDL_DUMP);
  });

  test('extracts store name and date', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    assert.equal(receipt.store, 'Lidl Rijswijk');
    assert.equal(receipt.date, '16-03-2026');
  });

  test('total_gross matches sum of all item prices', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    assert.equal(receipt.total_gross, 122.31);
  });

  test('total_net equals total_gross plus discounts', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    assert.equal(receipt.total_net, 115.11);
  });

  test('extracts 3 discounts with correct amounts', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    assert.equal(receipt.discounts.length, 3);
    assert.deepEqual(receipt.discounts, [
      { name: 'Lidl Plus korting', amount: -0.40 },
      { name: 'In prijs verlaagd', amount: -0.40 },
      { name: 'Emballage',         amount: -6.40 },
    ]);
  });

  test('extracts 28 items', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    assert.equal(receipt.items.length, 28);
  });

  test('weight items have weight_kg and unit_price_per_kg, no unit_price', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    const bananen = receipt.items.find(i => i.name === 'Fairtrade Bananen');
    assert.ok(bananen, 'should find Fairtrade Bananen');
    assert.equal(bananen.weight_kg, 1.41);
    assert.equal(bananen.unit_price_per_kg, 1.89);
    assert.equal(bananen.unit_price, undefined);
    assert.equal(bananen.paid_price, 2.66);
  });

  test('gember (second weight item) parsed correctly', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    const gember = receipt.items.find(i => i.name === 'Gember');
    assert.ok(gember);
    assert.equal(gember.weight_kg, 0.072);
    assert.equal(gember.unit_price_per_kg, 5.99);
    assert.equal(gember.paid_price, 0.43);
  });

  test('quantity items have correct quantity and unit_price', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    const eieren = receipt.items.find(i => i.name === 'Scharreleieren 12st');
    assert.ok(eieren);
    assert.equal(eieren.quantity, 3);
    assert.equal(eieren.unit_price, 3.75);
    assert.equal(eieren.paid_price, 11.25);
  });

  test('duplicate items both appear', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    const boxers = receipt.items.filter(i => i.name === 'Puma H boxershorts');
    assert.equal(boxers.length, 2);
    boxers.forEach(b => assert.equal(b.paid_price, 18.99));
  });

  test('article numbers are stripped from item names', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    // "Föhn-0493480" → "Föhn"
    assert.ok(receipt.items.some(i => i.name === 'Föhn'));
    assert.ok(!receipt.items.some(i => i.name.includes('0493480')));
    // "Sokken-0487054" → "Sokken"
    assert.ok(receipt.items.some(i => i.name === 'Sokken'));
  });

  test('all items have paid_price equal to price', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    receipt.items.forEach(item => {
      assert.equal(item.paid_price, item.price, `paid_price mismatch for ${item.name}`);
    });
  });

  test('no item has a type property (it is deleted after parsing)', () => {
    receipt = receipt ?? parseLidlText(LIDL_DUMP);
    receipt.items.forEach(item => {
      assert.ok(!('type' in item), `item ${item.name} should not have type`);
    });
  });
});

describe('parseLidlText — error handling', () => {
  test('throws when OMSCHRIJVING header is missing', () => {
    const text = 'Lidl Rijswijk\nSome items\nAantal 5 art.\nTotaal 10,00\n';
    assert.throws(
      () => parseLidlText(text),
      { message: /OMSCHRIJVING/ }
    );
  });

  test('throws when Aantal line is missing', () => {
    const text = 'Lidl Rijswijk\nOMSCHRIJVING EUR\nSpaghetti 0,95 B\n--\nTotaal 10,00\n';
    assert.throws(
      () => parseLidlText(text),
      { message: /Aantal/ }
    );
  });

  test('throws when separator between items and totals is missing', () => {
    const text = 'Lidl Rijswijk\nOMSCHRIJVING EUR\nSpaghetti 0,95 B\nAantal 1 art.\nTotaal 0,95\n';
    assert.throws(
      () => parseLidlText(text),
      { message: /separator/ }
    );
  });

  test('parses a minimal valid receipt', () => {
    const text = [
      'Lidl Test',
      'OMSCHRIJVING                         EUR',
      'Spaghetti HWG                       0,95 B',
      '------------------------------------------',
      'Aantal             1 art.',
      'Totaal                   0,95',
    ].join('\n');
    const result = parseLidlText(text);
    assert.equal(result.store, 'Lidl Test');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].name, 'Spaghetti HWG');
    assert.equal(result.total_gross, 0.95);
    assert.equal(result.total_net, 0.95);
    assert.equal(result.discounts.length, 0);
  });

  test('date returns null when absent', () => {
    const text = [
      'Lidl Test',
      'OMSCHRIJVING                         EUR',
      'Spaghetti HWG                       0,95 B',
      '------------------------------------------',
      'Aantal             1 art.',
      'Totaal                   0,95',
    ].join('\n');
    const result = parseLidlText(text);
    assert.equal(result.date, null);
  });
});