export function round2(n) {
  return Math.round(n * 100) / 100;
}

// Split a total evenly among people; the first person absorbs any rounding residual.
export function splitEqually(people, total) {
  if (people.length === 0) return {};
  const n = people.length;
  const perHead = round2(total / n);
  const result = {};
  people.forEach((p, i) => {
    result[p] = i === 0 ? round2(total - perHead * (n - 1)) : perHead;
  });
  return result;
}

// Running per-person totals during assignment (null entries are skipped).
export function computeRunningTotals(items, assigned) {
  const totals = {};
  items.forEach((item, i) => {
    const p = assigned[i];
    if (p != null) totals[p] = round2((totals[p] ?? 0) + item.paid_price);
  });
  return totals;
}

// Full settlement computation.
// receipt: { items: [{name, paid_price}], discounts: [{name, amount}] }
// assigned: (string|null)[] — null means the item belongs to the common pool
// Returns: { personTotals, commonTotal, commonItems, shares, settlements }
//   settlements: [{ person, ownItems, ownTotal, commonShare, owes }]
export function computeSettlement(receipt, assigned, people, common) {
  const allNames = [...people, common];
  const totals = Object.fromEntries(allNames.map(n => [n, 0]));
  const personItems = Object.fromEntries(allNames.map(n => [n, []]));

  receipt.items.forEach((item, i) => {
    const p = assigned[i] ?? common;
    totals[p] = round2(totals[p] + item.paid_price);
    personItems[p].push({ name: item.name, price: item.paid_price });
  });

  const discountTotal = round2(receipt.discounts.reduce((s, d) => s + d.amount, 0));
  if (discountTotal !== 0) {
    totals[common] = round2(totals[common] + discountTotal);
    personItems[common].push({ name: 'Total discount', price: discountTotal });
  }

  const shares = splitEqually(people, totals[common]);

  const settlements = people.map(person => ({
    person,
    ownItems: personItems[person],
    ownTotal: totals[person],
    commonShare: shares[person] ?? 0,
    owes: round2(totals[person] + (shares[person] ?? 0)),
  }));

  return {
    personTotals: totals,
    commonTotal: totals[common],
    commonItems: personItems[common],
    shares,
    settlements,
  };
}