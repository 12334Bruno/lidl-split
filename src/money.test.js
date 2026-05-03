import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { round2, splitEqually, computeRunningTotals, computeSettlement } from './money.js';

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
});

describe('computeSettlement', () => {
  const makeReceipt = (items, discounts = []) => ({ items, discounts });

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
