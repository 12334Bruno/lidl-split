import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  round2, splitEqually, computeRunningTotals, computeSettlement,
  equalPercentages, isValidPercentages, normalizePercentages, percentageAmount, previewPercentageAmounts, splitByPercentages,
} from './../src/money.js';

describe('round2', () => {
  test('handles exact values', () => {
    assert.equal(round2(1.5), 1.5);
    assert.equal(round2(0), 0);
    assert.equal(round2(115.11), 115.11);
  });

  test('fixes floating-point accumulation', () => {
    // 0.1 + 0.2 = 0.30000000000000004 without rounding
    assert.equal(round2(0.1 + 0.2), 0.3);
  });

  test('rounds negative amounts', () => {
    assert.equal(round2(-0.4), -0.4);
    assert.equal(round2(-6.4), -6.4);
    assert.equal(round2(-7.2), -7.2);
  });

  test('rounds up and down correctly', () => {
    assert.equal(round2(2.344), 2.34);
    assert.equal(round2(2.346), 2.35);
    assert.equal(round2(-0.401), -0.40);
  });
});

describe('splitEqually', () => {
  test('returns empty object for empty people list', () => {
    assert.deepEqual(splitEqually([], 10), {});
  });

  test('single person gets full amount', () => {
    assert.deepEqual(splitEqually(['Alice'], 5.50), { Alice: 5.50 });
  });

  test('two people, even split', () => {
    const result = splitEqually(['Alice', 'Bob'], 10.00);
    assert.equal(result.Alice, 5.00);
    assert.equal(result.Bob, 5.00);
  });

  test('two people, total sums correctly with non-divisible amount', () => {
    const result = splitEqually(['Alice', 'Bob'], 10.01);
    const sum = round2(result.Alice + result.Bob);
    assert.equal(sum, 10.01);
    // each share is ±0.01 of the per-head value
    assert.ok(Math.abs(result.Alice - 5.00) <= 0.01);
    assert.ok(Math.abs(result.Bob - 5.00) <= 0.01);
  });

  test('three people: residual goes to first person', () => {
    // 10.00 / 3 = 3.33... → perHead = 3.33, first = 3.34
    const result = splitEqually(['A', 'B', 'C'], 10.00);
    assert.equal(result.A, 3.34);
    assert.equal(result.B, 3.33);
    assert.equal(result.C, 3.33);
    assert.equal(round2(result.A + result.B + result.C), 10.00);
  });

  test('three people: when perHead rounds up, first person absorbs the underage', () => {
    // 10.01 / 3 = 3.3367 → perHead = 3.34, first = 3.33
    const result = splitEqually(['A', 'B', 'C'], 10.01);
    assert.equal(result.A, 3.33);
    assert.equal(result.B, 3.34);
    assert.equal(result.C, 3.34);
    assert.equal(round2(result.A + result.B + result.C), 10.01);
  });

  test('zero total: everyone gets 0', () => {
    const result = splitEqually(['Alice', 'Bob'], 0);
    assert.equal(result.Alice, 0);
    assert.equal(result.Bob, 0);
  });

  test('negative total (net discount on common pool)', () => {
    // e.g. common pool is -€7.20 after discounts exceed common items
    const result = splitEqually(['Alice', 'Bob'], -7.20);
    assert.equal(result.Alice, -3.60);
    assert.equal(result.Bob, -3.60);
  });
});

describe('percentage splits', () => {
  test('starts with equal percentages that add up to 100 for two to eight people', () => {
    for (let count = 2; count <= 8; count++) {
      const people = Array.from({ length: count }, (_, i) => `Person ${i + 1}`);
      const percentages = equalPercentages(people);
      assert.ok(isValidPercentages(percentages, people), `${count} people must total 100%`);
      const values = Object.values(percentages);
      assert.ok(Math.max(...values) - Math.min(...values) < 0.08);
    }
    assert.deepEqual(equalPercentages(['Alice', 'Bob']), { Alice: 50, Bob: 50 });
  });

  test('accepts decimal shares and zero shares', () => {
    assert.equal(isValidPercentages({ Alice: 33.33, Bob: 66.67 }), true);
    assert.equal(isValidPercentages({ Alice: 0, Bob: 100 }), true);
  });

  test('shows each person\'s current euro amount even when the total is incomplete', () => {
    assert.equal(percentageAmount(10, 50), 5);
    assert.equal(percentageAmount(10, 75), 7.5);
    assert.equal(percentageAmount(10, 125), 12.5);
    assert.equal(percentageAmount(10, null), null);
  });

  test('normalizes slider ratios to whole percentages totaling 100', () => {
    assert.deepEqual(normalizePercentages({ Alice: 50, Bob: 75 }, ['Alice', 'Bob']), {
      Alice: 40, Bob: 60,
    });
    assert.deepEqual(normalizePercentages({ Alice: 1, Bob: 1, Carol: 1 }, ['Alice', 'Bob', 'Carol']), {
      Alice: 34, Bob: 33, Carol: 33,
    });
    assert.deepEqual(normalizePercentages({ Alice: 0, Bob: 0 }, ['Alice', 'Bob']), {
      Alice: 50, Bob: 50,
    });
    assert.deepEqual(normalizePercentages({ Alice: -10, Bob: 2, Carol: null }, ['Alice', 'Bob', 'Carol']), {
      Alice: 0, Bob: 100, Carol: 0,
    });
  });

  test('keeps normalized ratios within one percent of their ideal shares for two to eight people', () => {
    for (let count = 2; count <= 8; count++) {
      const names = Array.from({ length: count }, (_, i) => `Person ${i + 1}`);
      const values = names.map((_, i) => i * 17);
      const percentages = Object.fromEntries(names.map((name, i) => [name, values[i]]));
      const total = values.reduce((sum, value) => sum + value, 0);
      const normalized = normalizePercentages(percentages, names);
      assert.ok(isValidPercentages(normalized, names));
      assert.equal(normalized[names[0]], 0, 'a zero share stays zero');
      names.forEach((name, i) => {
        assert.ok(Number.isInteger(normalized[name]));
        assert.ok(Math.abs(normalized[name] - values[i] / total * 100) < 1);
      });
      assert.deepEqual(normalizePercentages(normalized, names), normalized);
    }
  });

  test('normalizes large entered values without overflowing', () => {
    assert.deepEqual(normalizePercentages({ Alice: Number.MAX_VALUE, Bob: Number.MAX_VALUE }), {
      Alice: 50, Bob: 50,
    });
  });

  test('previews incomplete and excessive totals without normalizing their prices', () => {
    assert.deepEqual(previewPercentageAmounts(10, { Alice: 10, Bob: 20, Carol: 30 }), {
      Alice: 1, Bob: 2, Carol: 3,
    });
    assert.deepEqual(previewPercentageAmounts(10, { Alice: 50, Bob: 75, Carol: 0 }), {
      Alice: 5, Bob: 7.5, Carol: 0,
    });
    assert.deepEqual(previewPercentageAmounts(10, { Alice: null, Bob: 20, Carol: 30 }), {
      Alice: null, Bob: 2, Carol: 3,
    });
  });

  test('previews a completed split using the exact same cents as settlement', () => {
    assert.deepEqual(previewPercentageAmounts(0.01, { Alice: 50, Bob: 50 }), {
      Alice: 0.01, Bob: 0,
    });
  });

  test('rejects incomplete, out-of-range, or over-precise percentages', () => {
    for (const percentages of [
      {}, { Alice: 100 }, { Alice: 30, Bob: 60 }, { Alice: 60, Bob: 60 },
      { Alice: -10, Bob: 110 }, { Alice: null, Bob: 100 },
      { Alice: NaN, Bob: 100 }, { Alice: Infinity, Bob: 0 },
      { Alice: '50', Bob: 50 }, { Alice: 33.333, Bob: 66.667 },
    ]) assert.equal(isValidPercentages(percentages), false, JSON.stringify(percentages));
    assert.equal(isValidPercentages({ Alice: 50, Bob: 50 }, ['Alice', 'Carol']), false);
  });

  test('splits a two-person item using the chosen percentages', () => {
    assert.deepEqual(splitByPercentages(10, { Alice: 25, Bob: 75 }), { Alice: 2.5, Bob: 7.5 });
  });

  test('provides the current euro price for every two-person split row', () => {
    const shares = splitByPercentages(14.99, { Alice: 25, Bob: 75 });
    assert.equal(shares.Alice.toFixed(2), '3.75');
    assert.equal(shares.Bob.toFixed(2), '11.24');
    assert.equal(round2(Object.values(shares).reduce((sum, amount) => sum + amount, 0)), 14.99);
  });

  test('keeps the full item price when rounding three decimal shares', () => {
    assert.deepEqual(splitByPercentages(10, { Alice: 33.34, Bob: 33.33, Carol: 33.33 }), {
      Alice: 3.34, Bob: 3.33, Carol: 3.33,
    });
  });

  test('provides the current euro price for every three-person split row', () => {
    const shares = splitByPercentages(12.00, { Alice: 50, Bob: 30, Carol: 20 });
    assert.deepEqual(shares, { Alice: 6, Bob: 3.6, Carol: 2.4 });
  });

  test('never charges a zero-percent person when distributing leftover cents', () => {
    assert.deepEqual(splitByPercentages(0.01, { Alice: 0, Bob: 50, Carol: 50 }), {
      Alice: 0, Bob: 0.01, Carol: 0,
    });
  });

  test('conserves cents for tiny amounts, returns, and eight-person groups', () => {
    const percentages = equalPercentages(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    for (const amount of [0, 0.01, 0.02, 0.07, 1.01, 10.99, 115.11, -0.01, -10.99]) {
      const shares = Object.values(splitByPercentages(amount, percentages));
      assert.equal(round2(shares.reduce((sum, share) => sum + share, 0)), amount);
      assert.ok(shares.every(share => amount < 0 ? share <= 0 : share >= 0));
    }
  });

  test('refuses to calculate an invalid split', () => {
    assert.throws(() => splitByPercentages(10, { Alice: 40, Bob: 40 }), /100%/);
  });
});

describe('computeRunningTotals', () => {
  test('returns empty object when nothing is assigned', () => {
    const items = [{ paid_price: 1.00 }, { paid_price: 2.00 }];
    assert.deepEqual(computeRunningTotals(items, [null, null]), {});
  });

  test('returns empty object for empty items list', () => {
    assert.deepEqual(computeRunningTotals([], []), {});
  });

  test('sums correctly for partially assigned list', () => {
    const items = [
      { paid_price: 1.00 },
       { paid_price: 3.00 },
       { paid_price: 10.00 },
    ];
    const result = computeRunningTotals(items, ['Alice', 'Bob', null]);
    assert.equal(result.Alice, 1.00);
    assert.equal(result.Bob, 3.00);
    assert.equal(result.Common, undefined);
  });

  test('accumulates multiple items for the same person', () => {
    const items = [
      { paid_price: 1.00 },
      { paid_price: 2.50 },
      { paid_price: 0.99 },
    ];
    const result = computeRunningTotals(items, ['Alice', 'Alice', 'Bob']);
    assert.equal(result.Alice, 3.50);
    assert.equal(result.Bob, 0.99);
  });

  test('handles floating-point accumulation correctly', () => {
    // 0.1 + 0.2 should not produce 0.30000000000000004
    const items = [{ paid_price: 0.1 }, { paid_price: 0.2 }];
    const result = computeRunningTotals(items, ['Alice', 'Alice']);
    assert.equal(result.Alice, 0.3);
  });

  test('percentage splits override ordinary assignments in live totals', () => {
    const items = [{ paid_price: 10 }, { paid_price: 2 }];
    const splits = [{ enabled: true, percentages: { Alice: 25, Bob: 75 } }];
    assert.deepEqual(computeRunningTotals(items, ['Common', 'Alice'], splits), { Alice: 4.5, Bob: 7.5 });
  });

  test('unfinished percentage splits stay out of live totals', () => {
    const items = [{ paid_price: 10 }, { paid_price: 2 }];
    const splits = [{ enabled: true, percentages: { Alice: 25, Bob: 50 } }];
    assert.deepEqual(computeRunningTotals(items, ['Common', 'Alice'], splits), { Alice: 2 });
  });

  test('a disabled percentage split uses the ordinary assignment', () => {
    const splits = [{ enabled: false, percentages: { Alice: 25, Bob: 75 } }];
    assert.deepEqual(computeRunningTotals([{ paid_price: 10 }], ['Alice'], splits), { Alice: 10 });
  });
});

describe('computeSettlement', () => {
  const makeReceipt = (items, discounts = []) => ({ items, discounts });

  test('combines custom percentages with personal items, equal shares, and discounts', () => {
    const receipt = makeReceipt([
      { name: 'Coffee', paid_price: 10 }, { name: 'Bread', paid_price: 3 },
      { name: 'Milk', paid_price: 2 },
    ], [{ name: 'Discount', amount: -1 }]);
    const splits = [{ enabled: true, percentages: { Alice: 50, Bob: 30, Carol: 20 } }];
    const result = computeSettlement(receipt, ['Common', 'Bob', null], ['Alice', 'Bob', 'Carol'], 'Common', splits);
    assert.deepEqual(result.settlements.map(s => s.owes), [5.34, 6.33, 2.33]);
    assert.equal(round2(result.settlements.reduce((sum, s) => sum + s.owes, 0)), 14);
    assert.equal(result.commonTotal, 1);
    assert.deepEqual(result.settlements[1].ownItems, [
      { name: 'Coffee', price: 3, percentage: 30 }, { name: 'Bread', price: 3 },
    ]);
    assert.deepEqual(result.commonItems, [
      { name: 'Milk', price: 2 }, { name: 'Total discount', price: -1 },
    ]);
  });

  test('rejects invalid or outdated percentage splits before settlement', () => {
    const receipt = makeReceipt([{ name: 'Coffee', paid_price: 10 }]);
    for (const percentages of [{ Alice: 40, Bob: 40 }, { Alice: 50, Carol: 50 }]) {
      assert.throws(() => computeSettlement(receipt, [null], ['Alice', 'Bob'], 'Common', [
        { enabled: true, percentages },
      ]), /100%/);
    }
  });

  test('basic 2-person split, no common items', () => {
    const receipt = makeReceipt([
      { name: 'Apple', paid_price: 1.00 },
      { name: 'Bread', paid_price: 3.00 },
    ]);
    const { settlements } = computeSettlement(receipt, ['Alice', 'Bob'], ['Alice', 'Bob'], 'Common');
    const alice = settlements.find(s => s.person === 'Alice');
    const bob   = settlements.find(s => s.person === 'Bob');
    assert.equal(alice.ownTotal, 1.00);
    assert.equal(alice.commonShare, 0);
    assert.equal(alice.owes, 1.00);
    assert.equal(bob.ownTotal, 3.00);
    assert.equal(bob.owes, 3.00);
  });

  test('all items unassigned: everything goes to common pool and is split', () => {
    const receipt = makeReceipt([{ name: 'Wine', paid_price: 10.00 }]);
    const { settlements, commonTotal } = computeSettlement(receipt, [null], ['Alice', 'Bob'], 'Common');
    assert.equal(commonTotal, 10.00);
    const alice = settlements.find(s => s.person === 'Alice');
    const bob   = settlements.find(s => s.person === 'Bob');
    assert.equal(alice.ownTotal, 0);
    assert.equal(alice.commonShare, 5.00);
    assert.equal(alice.owes, 5.00);
    assert.equal(bob.owes, 5.00);
  });

  test('mix of personal and common items', () => {
    const receipt = makeReceipt([
      { name: 'Apple', paid_price: 1.00 },
      { name: 'Bread', paid_price: 3.00 },
      { name: 'Wine',  paid_price: 10.00 },
    ]);
    const { settlements } = computeSettlement(receipt, ['Alice', 'Bob', null], ['Alice', 'Bob'], 'Common');
    const alice = settlements.find(s => s.person === 'Alice');
    const bob   = settlements.find(s => s.person === 'Bob');
    // common = 10.00, each share = 5.00
    assert.equal(alice.owes, 6.00);  // 1.00 + 5.00
    assert.equal(bob.owes,   8.00);  // 3.00 + 5.00
  });

  test('discounts reduce the common pool', () => {
    const receipt = makeReceipt(
      [
        { name: 'Apple', paid_price: 1.00 },
        { name: 'Bread', paid_price: 3.00 },
        { name: 'Wine',  paid_price: 10.00 },
      ],
      [{ name: 'Lidl Plus korting', amount: -1.00 }]
    );
    const { settlements, commonTotal } = computeSettlement(receipt, ['Alice', 'Bob', null], ['Alice', 'Bob'], 'Common');
    assert.equal(commonTotal, 9.00);  // 10.00 - 1.00
    const alice = settlements.find(s => s.person === 'Alice');
    const bob   = settlements.find(s => s.person === 'Bob');
    assert.equal(alice.owes, 5.50);  // 1.00 + 4.50
    assert.equal(bob.owes,   7.50);  // 3.00 + 4.50
  });

  test('multiple discounts are summed before reducing common pool', () => {
    const receipt = makeReceipt(
      [{ name: 'Misc', paid_price: 20.00 }],
      [
        { name: 'Korting 1', amount: -1.00 },
        { name: 'Korting 2', amount: -0.40 },
      ]
    );
    const { commonTotal } = computeSettlement(receipt, [null], ['Alice', 'Bob'], 'Common');
    assert.equal(commonTotal, 18.60);
  });

  test('three people: rounding residual is absorbed consistently', () => {
    const receipt = makeReceipt([{ name: 'Shared', paid_price: 10.00 }]);
    const { settlements } = computeSettlement(receipt, [null], ['A', 'B', 'C'], 'Common');
    const owes = settlements.map(s => s.owes);
    // Total owed must equal the item price
    const total = round2(owes.reduce((s, v) => s + v, 0));
    assert.equal(total, 10.00);
    // No share can differ from another by more than 1 cent
    const max = Math.max(...owes);
    const min = Math.min(...owes);
    assert.ok(max - min <= 0.01);
  });

  test('personTotals keys include both people and common', () => {
    const receipt = makeReceipt([{ name: 'X', paid_price: 5.00 }]);
    const { personTotals } = computeSettlement(receipt, ['Alice'], ['Alice', 'Bob'], 'Common');
    assert.ok('Alice' in personTotals);
    assert.ok('Bob' in personTotals);
    assert.ok('Common' in personTotals);
  });

  test('commonItems includes discount summary entry when discounts exist', () => {
    const receipt = makeReceipt(
      [{ name: 'Wine', paid_price: 10.00 }],
      [{ name: 'Sale', amount: -2.00 }]
    );
    const { commonItems } = computeSettlement(receipt, [null], ['Alice', 'Bob'], 'Common');
    const discountEntry = commonItems.find(it => it.name === 'Total discount');
    assert.ok(discountEntry, 'discount entry should appear in commonItems');
    assert.equal(discountEntry.price, -2.00);
  });

  test('integration: sum of all owes equals total_net of receipt', () => {
    // Items: Alice 1.00, Bob 3.00, common 10.00 → total_gross 14.00
    // Discount: -1.00 → total_net 13.00
    const receipt = makeReceipt(
      [
        { name: 'Apple', paid_price: 1.00 },
        { name: 'Bread', paid_price: 3.00 },
        { name: 'Wine',  paid_price: 10.00 },
      ],
      [{ name: 'Discount', amount: -1.00 }]
    );
    const total_net = 13.00;
    const { settlements } = computeSettlement(receipt, ['Alice', 'Bob', null], ['Alice', 'Bob'], 'Common');
    const totalOwed = round2(settlements.reduce((s, v) => s + v.owes, 0));
    assert.equal(totalOwed, total_net);
  });
});
