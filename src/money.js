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

export function equalPercentages(people) {
  const each = Math.floor(10000 / people.length);
  return Object.fromEntries(people.map((person, i) => [
    person, (each + (i === 0 ? 10000 - each * people.length : 0)) / 100,
  ]));
}

export function isValidPercentages(percentages, people = Object.keys(percentages ?? {})) {
  if (!percentages || people.length < 2 || Object.keys(percentages).length !== people.length) return false;
  const values = people.map(person => percentages[person]);
  return values.every(value => typeof value === 'number' && Number.isFinite(value)
    && value >= 0 && value <= 100 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8)
    && values.reduce((sum, value) => sum + Math.round(value * 100), 0) === 10000;
}

export function splitByPercentages(total, percentages) {
  if (!isValidPercentages(percentages)) throw new Error('Percentages must add up to 100%.');
  const cents = Math.round(Math.abs(total) * 100);
  const parts = Object.entries(percentages).map(([person, percentage]) => {
    const amount = cents * Math.round(percentage * 100) / 10000;
    return { person, cents: Math.floor(amount), remainder: amount - Math.floor(amount) };
  });
  let remaining = cents - parts.reduce((sum, part) => sum + part.cents, 0);
  // Give leftover cents to the shares closest to the next cent.
  for (const part of [...parts].sort((a, b) => b.remainder - a.remainder)) {
    if (remaining <= 0) break;
    part.cents++;
    remaining--;
  }
  return Object.fromEntries(parts.map(part => [
    part.person, part.cents === 0 ? 0 : (total < 0 ? -part.cents : part.cents) / 100,
  ]));
}

// Running per-person totals during assignment (null entries are skipped).
export function computeRunningTotals(items, assigned, splits = []) {
  const totals = {};
  items.forEach((item, i) => {
    if (splits[i]?.enabled) {
      if (isValidPercentages(splits[i].percentages)) {
        for (const [person, amount] of Object.entries(splitByPercentages(item.paid_price, splits[i].percentages))) {
          totals[person] = round2((totals[person] ?? 0) + amount);
        }
      }
      return;
    }
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
export function computeSettlement(receipt, assigned, people, common, splits = []) {
  const allNames = [...people, common];
  const totals = Object.fromEntries(allNames.map(n => [n, 0]));
  const personItems = Object.fromEntries(allNames.map(n => [n, []]));

  receipt.items.forEach((item, i) => {
    if (splits[i]?.enabled) {
      const percentages = splits[i].percentages;
      if (!isValidPercentages(percentages, people)) throw new Error('Percentages must add up to 100%.');
      for (const [person, price] of Object.entries(splitByPercentages(item.paid_price, percentages))) {
        if (percentages[person] === 0) continue;
        totals[person] = round2(totals[person] + price);
        personItems[person].push({ name: item.name, price, percentage: percentages[person] });
      }
      return;
    }
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
