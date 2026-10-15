import { parseLidlText } from './parser.js';
import { enhanceSliderHaptics } from './haptics.js?v=slider-feedback-1';
import {
  round2, computeRunningTotals, computeSettlement, equalPercentages,
  isValidPercentages, normalizePercentages, previewPercentageAmounts,
} from './money.js?v=percentage-splits-3';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

// ── Settings ──────────────────────────────────
function loadSettings() {
  let people;
  try { people = JSON.parse(localStorage.getItem('people')); } catch {}
  if (!Array.isArray(people) || people.length < 2) {
    const p1 = localStorage.getItem('p1') || 'David';
    const p2 = localStorage.getItem('p2') || 'Bruno';
    people = [p1, p2];
  }
  return { people, common: localStorage.getItem('common') || 'Common' };
}
function getPeople()   { return loadSettings().people; }
function getCommon()   { return loadSettings().common; }
function getAllNames()  { const s = loadSettings(); return [...s.people, s.common]; }

// 8 distinct colors for up to 8 people + common always last slot
const SLOT_COLORS = ['#1D4ED8','#B91C1C','#047857','#7C3AED','#D97706','#0891B2','#BE185D','#374151','#047857'];

function getColors() {
  const people = getPeople();
  const out = {};
  people.forEach((n, i) => { out[n] = SLOT_COLORS[i % (SLOT_COLORS.length - 1)]; });
  out[getCommon()] = SLOT_COLORS[SLOT_COLORS.length - 1];
  return out;
}

function openSettings() {
  const s = loadSettings();
  renderSettingsPeople(s.people);
  document.getElementById('setting-common').value = s.common;
  document.getElementById('settings-modal').classList.add('open');
}

function renderSettingsPeople(people) {
  document.getElementById('settings-people-list').innerHTML = people.map((entry, i) => {
    const { name, original } = typeof entry === 'string' ? { name: entry, original: entry } : entry;
    return `
    <div class="settings-person-row">
      <span class="settings-person-num" style="color:${SLOT_COLORS[i % (SLOT_COLORS.length-1)]}">${i + 1}</span>
      <input type="text" class="settings-person-input" value="${escapeHtml(name)}"
        data-original-name="${escapeHtml(original)}" aria-label="Person ${i + 1} name" placeholder="Name">
      ${people.length > 2
        ? `<button class="settings-remove-btn" onclick="removeSettingsPerson(${i})">✕</button>`
        : '<span style="width:28px"></span>'}
    </div>`;
  }).join('');
}

function addSettingsPerson() {
  const current = getSettingsPeopleFromForm();
  if (current.length >= 8) return;
  renderSettingsPeople([...current, { name: '', original: '' }]);
  const inputs = document.querySelectorAll('.settings-person-input');
  inputs[inputs.length - 1].focus();
}

function removeSettingsPerson(idx) {
  const current = getSettingsPeopleFromForm();
  current.splice(idx, 1);
  renderSettingsPeople(current);
}

function getSettingsPeopleFromForm() {
  return Array.from(document.querySelectorAll('.settings-person-input')).map(el => ({
    name: el.value.trim(), original: el.dataset.originalName,
  }));
}

function closeSettings() { document.getElementById('settings-modal').classList.remove('open'); }

function saveSettings() {
  const raw    = getSettingsPeopleFromForm();
  const people = raw.map((entry, i) => entry.name || `Person ${i + 1}`);
  if (people.length < 2) { alert('You need at least 2 people.'); return; }
  const common = document.getElementById('setting-common').value.trim() || 'Common';
  if (new Set([...people, common]).size !== people.length + 1) {
    alert('Give each person and the shared group a different name.');
    return;
  }

  const oldPeople = getPeople();
  const oldCommon = getCommon();
  const nameMap   = {};
  raw.forEach((entry, i) => { if (entry.original) nameMap[entry.original] = people[i]; });
  nameMap[oldCommon] = common;

  if (appState.assigned) {
    appState.assigned = appState.assigned.map(a => a ? nameMap[a] ?? null : null);
  }
  if (appState.payer && nameMap[appState.payer]) {
    appState.payer = nameMap[appState.payer];
  } else {
    appState.payer = people[0];
  }

  const remapPercentages = percentages => Object.fromEntries(
    Object.entries(percentages ?? {})
      .filter(([name]) => !oldPeople.includes(name) || nameMap[name])
      .map(([name, value]) => [nameMap[name] ?? name, value])
  );
  const splitMemory = loadSplitMemory();
  for (const split of Object.values(splitMemory)) {
    if (split && typeof split === 'object') split.percentages = remapPercentages(split.percentages);
  }
  localStorage.setItem('percentageSplits', JSON.stringify(splitMemory));
  appState.splits = appState.splits.map(split => ({
    ...split, percentages: percentagesForPeople(remapPercentages(split.percentages), people),
  }));

  localStorage.setItem('people', JSON.stringify(people));
  localStorage.setItem('common', common);
  closeSettings();
  if (appState.screen === 'assign') renderAssignScreen();
  if (appState.screen === 'settle') {
    if (appState.splits.some(split => split.enabled && !isValidPercentages(split.percentages, people))) goAssign();
    else renderSettleScreen();
  }
}

// ── Memory ────────────────────────────────────
const MAXAGE = 100;
function loadMemory() { try { return JSON.parse(localStorage.getItem('memory') || '{}'); } catch { return {}; } }
function saveMemory(m) { localStorage.setItem('memory', JSON.stringify(m)); }

function recordAssignment(itemName, person) {
  const mem = loadMemory();
  if (!mem[itemName]) mem[itemName] = {};
  mem[itemName][person] = (mem[itemName][person] || 0) + 1;
  const total = Object.values(mem[itemName]).reduce((a, b) => a + b, 0);
  if (total > MAXAGE) {
    const k = total / (MAXAGE * 0.9);
    mem[itemName] = Object.fromEntries(
      Object.entries(mem[itemName]).map(([p, s]) => [p, s / k]).filter(([, s]) => s >= 1)
    );
  }
  saveMemory(mem);
}

function getSuggestion(itemName) {
  const bucket = loadMemory()[itemName];
  if (!bucket || !Object.keys(bucket).length) return { name: null, conf: 0 };
  const entries = Object.entries(bucket).filter(([name]) => getAllNames().includes(name));
  if (!entries.length) return { name: null, conf: 0 };
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const [name, count] = entries.sort((a, b) => b[1] - a[1])[0];
  return { name, conf: count / total };
}

function loadSplitMemory() {
  try {
    const memory = JSON.parse(localStorage.getItem('percentageSplits') || '{}');
    return memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  } catch { return {}; }
}

function percentagesForPeople(percentages, people = getPeople()) {
  return Object.fromEntries(people.map(person => [
    person, Object.hasOwn(percentages ?? {}, person) ? percentages[person] : 0,
  ]));
}

function rememberSplit(idx) {
  localStorage.setItem('percentageSplits', JSON.stringify({
    ...loadSplitMemory(), [appState.receipt.items[idx].name]: appState.splits[idx],
  }));
}

function itemIsAssigned(idx) {
  const split = appState.splits[idx];
  return split?.enabled ? isValidPercentages(split.percentages, getPeople()) : Boolean(appState.assigned[idx]);
}

// ── App State ─────────────────────────────────
const appState = { screen: 'paste', receipt: null, assigned: [], splits: [], selectedIdx: 0, payer: null };

// ── Navigation ────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  appState.screen = name;
  window.scrollTo(0, 0);
}
function goBack()   { showScreen('paste'); }
function goAssign() { showScreen('assign'); renderAssignScreen(); }
function startOver() {
  document.getElementById('receipt-input').value = '';
  document.getElementById('header-subtitle').textContent = 'Split your Lidl receipt';
  showScreen('paste');
}

// ── Parse Button ──────────────────────────────
function handleParse() {
  const text   = document.getElementById('receipt-input').value.trim();
  const errBox = document.getElementById('parse-error');
  errBox.classList.remove('visible');
  if (!text) { errBox.textContent = 'Please paste your receipt text first.'; errBox.classList.add('visible'); return; }
  try {
    appState.receipt = parseLidlText(text);
    const items = appState.receipt.items;
    appState.assigned = items.map(item => {
      const s = getSuggestion(item.name);
      return (s.name && s.conf >= 0.75) ? s.name : null;
    });
    const splitMemory = loadSplitMemory();
    appState.splits = items.map(item => {
      const saved = splitMemory[item.name];
      return {
        enabled: saved?.enabled === true,
        percentages: saved?.percentages
          ? percentagesForPeople(saved.percentages) : equalPercentages(getPeople()),
      };
    });
    appState.selectedIdx = items.findIndex((_, i) => !itemIsAssigned(i));
    if (appState.selectedIdx === -1) appState.selectedIdx = 0;
    appState.payer = getPeople()[0];
    const sub = [appState.receipt.store, appState.receipt.date].filter(Boolean).join(' · ');
    document.getElementById('header-subtitle').textContent = sub || 'Receipt loaded';
    showScreen('assign');
    renderAssignScreen();
  } catch (e) {
    errBox.textContent = '⚠️ ' + e.message;
    errBox.classList.add('visible');
  }
}

// ── Assign Screen ─────────────────────────────
function renderAssignScreen() {
  renderMeta(); renderProgress(); renderTotalsBar(); renderPersonButtons(); renderItemsList(); scrollToSelected();
}

function renderMeta() {
  const r = appState.receipt;
  document.getElementById('receipt-meta').innerHTML = `
    <div><div class="store">${escapeHtml(r.store || 'Lidl')}</div><div class="date">${escapeHtml(r.date || '')}</div></div>
    <div class="totals"><div class="total-label">Total paid</div><div class="total-amount">€${r.total_net.toFixed(2)}</div></div>`;
}

function renderProgress() {
  const total = appState.assigned.length;
  const done  = appState.assigned.filter((_, i) => itemIsAssigned(i)).length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  document.getElementById('progress-text').textContent = `${done} of ${total} assigned`;
  document.getElementById('progress-pct').textContent  = pct + '%';
  document.getElementById('progress-fill').style.width = pct + '%';
  const invalid = appState.splits.some(split => split.enabled && !isValidPercentages(split.percentages, getPeople()));
  document.getElementById('assign-done').disabled = invalid;
  document.getElementById('split-error').hidden = !invalid;
}

function renderTotalsBar() {
  const names   = getAllNames();
  const colors  = getColors();
  const totals  = computeRunningTotals(appState.receipt.items, appState.assigned, appState.splits);
  names.forEach(n => { if (totals[n] == null) totals[n] = 0; });
  const discount = appState.receipt.discounts.reduce((s, d) => s + d.amount, 0);
  const many = names.length > 4;
  document.getElementById('totals-bar').innerHTML =
    names.map(n => `
      <div class="totals-chip">
        <span class="chip-label" style="color:${colors[n]}">${escapeHtml(many && n.length > 4 ? n.slice(0,3) : n)}</span>
        <span class="chip-value">€${totals[n].toFixed(2)}</span>
      </div>`).join('') +
    (discount !== 0 ? `<div class="totals-chip">
        <span class="chip-label" style="color:var(--green-disc)">Disc.</span>
        <span class="chip-value" style="color:var(--green-disc)">${discount.toFixed(2)}</span>
      </div>` : '');
}

// ── Grid renderer (shared by person buttons and payer buttons) ────────────────
// items: [{ name, callback, color?, number?, selected?, btnClass? }]
// number: small label above abbreviation; omit for full-name layout
// selected: if key is present, color only applied when true (payer style); if absent, always applied (person style)
function renderGrid(container, items, maxCols = 4) {
  const cols = Math.min(items.length, maxCols);

  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  container.replaceChildren(...items.map((item) => {
    const { name, color, number, selected, btnClass = 'person-btn' } = item;
    const isSelectable = 'selected' in item;
    const btn = document.createElement('button');

    btn.className = [btnClass, isSelectable && selected ? 'selected' : ''].filter(Boolean).join(' ');
    if (color) {
      if (!isSelectable) {
        btn.style.background = color;
      } else if (selected) {
        btn.style.background = color;
        btn.style.borderColor = color;
      }
    }

    const abbr = name.length > 3 ? name.slice(0, 3) : name;
    btn.innerHTML = number != null
      ? `<span class="btn-num">${number}</span><span class="btn-abbr">${escapeHtml(abbr)}</span>`
      : `<span class="btn-name">${escapeHtml(name)}</span>`;

    btn.onclick = item.callback;
    return btn;
  }));
}

function renderPersonButtons() {
  const people = getPeople();
  const common = getCommon();
  const colors = getColors();
  const few    = people.length <= 2;
  const all    = [...people, common];

  const container = document.getElementById('person-btns');
  container.className = 'person-btns' + (few ? ' few' : '');
  renderGrid(container, all.map((name, i) => ({
    name,
    color: colors[name],
    number: few ? null : (i === people.length ? '★' : i + 1),
    callback: () => assignSelected(name),
  })));
}

function renderItemsList() {
  const colors = getColors();
  const r = appState.receipt;
  let html = '';

  r.items.forEach((item, i) => {
    const person     = appState.assigned[i];
    const split      = appState.splits[i];
    const assigned   = itemIsAssigned(i);
    const isSelected = i === appState.selectedIdx;
    const color      = split.enabled ? 'var(--primary)' : person ? colors[person] : 'transparent';
    const sugg       = getSuggestion(item.name);
    const wt         = item.weight_kg;
    const detail     = wt
      ? `${wt.toFixed(3)} kg × €${item.unit_price_per_kg?.toFixed(2)}/kg`
      : item.quantity > 1 ? `${item.quantity} × €${item.unit_price.toFixed(2)}` : '';

    const badgeHtml = split.enabled
      ? `<div class="assignment-badge ${assigned ? 'filled' : 'invalid'}">${assigned ? 'Percentages' : 'Check split'}</div>`
      : person
      ? `<div class="assignment-badge filled" style="--person-color:${colors[person]};background:${colors[person]}">${escapeHtml(getPeople().length > 2 ? person.slice(0,3) : person)}</div>`
      : (sugg.name && sugg.conf >= 0.5)
        ? `<div class="assignment-badge empty">→ ${escapeHtml(getPeople().length > 2 ? sugg.name.slice(0,3) : sugg.name)}</div>`
        : `<div class="assignment-badge empty">—</div>`;

    const splitButtonHtml = `<button type="button" class="split-menu-button ${split.enabled ? 'active' : ''}"
      aria-expanded="${split.enabled}" aria-controls="split-controls-${i}"
      aria-pressed="${split.enabled}" aria-label="${split.enabled ? 'Close' : 'Open'} percentage split for ${escapeHtml(item.name)}"
      title="${split.enabled ? 'Close' : 'Open'} percentage split" onclick="event.stopPropagation(); toggleItemSplit(${i}, ${!split.enabled})">%</button>`;

    html += `
      <div class="item-card ${assigned ? 'assigned' : ''} ${isSelected ? 'selected' : ''}" data-item-index="${i}"
           style="--person-color:${color}"
           onclick="selectItem(${i})">
        <div class="item-main">
          <div class="item-info">
            <div class="item-name">${escapeHtml(item.name)}</div>
            ${detail ? `<div class="item-detail">${detail}</div>` : ''}
          </div>
          <div class="item-right">
            <div class="item-price">€${item.paid_price.toFixed(2)}</div>
            <div class="item-actions">${badgeHtml}${splitButtonHtml}</div>
          </div>
        </div>
        <div id="split-controls-${i}" class="split-controls" ${split.enabled ? '' : 'hidden'}
          onclick="event.stopPropagation()">
          ${split.enabled ? renderSplitControls(i) : ''}
        </div>
      </div>`;
  });

  if (r.discounts.length > 0) {
    html += `<div class="section-title">Discounts &amp; returns</div>`;
    r.discounts.forEach(d => {
      html += `<div class="discount-row">
        <span class="d-name">${escapeHtml(d.name)}</span>
        <span class="d-amount">€${d.amount.toFixed(2)}</span>
      </div>`;
    });
  }

  document.getElementById('items-list').innerHTML = html;
}

function renderSplitControls(idx) {
  const people = getPeople();
  const percentages = appState.splits[idx].percentages;
  const colors = getColors();
  const twoPeople = people.length === 2;
  const amounts = previewPercentageAmounts(appState.receipt.items[idx].paid_price, percentages, people);
  const shareText = person => {
    const amount = amounts[person];
    return amount == null ? '—' : `€${amount.toFixed(2)}`;
  };
  const fields = (twoPeople ? people.slice(0, 1) : people).map((person, personIdx) => {
    const value = percentages[person];
    const sliderValue = Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
    const name = escapeHtml(person);
    return `
      ${twoPeople ? '' : `<label class="split-person" for="percentage-${idx}-${personIdx}" style="color:${colors[person]}"><span>${name}</span><strong class="split-person-price" data-share-price="${personIdx}">${shareText(person)}</strong></label>`}
      <div class="split-row">
        <div class="percentage-field">
          <input id="percentage-${idx}-${personIdx}" type="number" min="0" max="100" step="0.01"
            inputmode="decimal" value="${value ?? ''}" aria-label="${name} percentage"
            aria-describedby="split-status-${idx}" data-percentage-input="${personIdx}"
            oninput="updateItemPercentage(${idx}, ${personIdx}, this)">
          <span aria-hidden="true">%</span>
        </div>
        <input class="percentage-slider" type="range" min="0" max="100" step="1"
          value="${sliderValue}"
          aria-label="${name} percentage slider" aria-describedby="split-status-${idx}"
          style="--slider-color:${colors[person]};--slider-progress:${sliderValue}%" data-percentage-input="${personIdx}"
          oninput="updateItemPercentage(${idx}, ${personIdx}, this)">
      </div>`;
  }).join('');
  return `
    <div class="split-controls-head">
      <span class="split-controls-title">Percentage split</span>
      <button type="button" class="normalize-button" onclick="normalizeItemSplit(${idx})">Normalize</button>
    </div>
    ${twoPeople ? `<div class="split-pair-labels">${people.map((person, personIdx) => `
      <span style="color:${colors[person]}"><span>${escapeHtml(person)}</span> <strong data-percentage-label="${personIdx}">${percentages[person] == null ? '—' : percentages[person] + '%'}</strong> <strong class="split-person-price" data-share-price="${personIdx}">${shareText(person)}</strong></span>`).join('')}</div>` : ''}
    ${fields}
    <p id="split-status-${idx}" class="split-status ${isValidPercentages(percentages, people) ? '' : 'invalid'}" role="status">${splitStatusText(percentages)}</p>`;
}

function splitStatusText(percentages) {
  const values = Object.values(percentages);
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) {
    return 'Enter a percentage from 0 to 100 for each person.';
  }
  if (values.some(value => Math.abs(value * 100 - Math.round(value * 100)) >= 1e-8)) {
    return 'Use up to 2 decimal places.';
  }
  const total = round2(values.reduce((sum, value) => sum + value, 0));
  return isValidPercentages(percentages, getPeople())
    ? 'Total: 100%' : `Total: ${total}%. Must add up to 100%.`;
}

function toggleItemSplit(idx, enabled) {
  appState.splits[idx].enabled = enabled;
  appState.selectedIdx = idx;
  rememberSplit(idx);
  renderProgress();
  renderTotalsBar();
  renderItemsList();
  // Keep keyboard focus on the compact control after replacing the item cards.
  document.querySelector(`[data-item-index="${idx}"] .split-menu-button`).focus({ preventScroll: true });
}

function normalizeItemSplit(idx) {
  const people = getPeople();
  appState.splits[idx].percentages = normalizePercentages(appState.splits[idx].percentages, people);
  appState.selectedIdx = idx;
  rememberSplit(idx);
  renderProgress();
  renderTotalsBar();
  renderItemsList();
  document.querySelector(`[data-item-index="${idx}"] .normalize-button`).focus({ preventScroll: true });
}

function updateItemPercentage(idx, personIdx, input) {
  const people = getPeople();
  const split = appState.splits[idx];
  const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null;
  split.percentages[people[personIdx]] = value;
  if (people.length === 2) {
    split.percentages[people[1 - personIdx]] = value == null ? null : round2(100 - value);
  }
  appState.selectedIdx = idx;
  rememberSplit(idx);
  const card = document.querySelector(`[data-item-index="${idx}"]`);
  card.querySelectorAll('[data-percentage-input]').forEach(field => {
    if (field !== input) {
      const percentage = split.percentages[people[Number(field.dataset.percentageInput)]];
      field.value = percentage ?? (field.type === 'range' ? 0 : '');
    }
    if (field.type === 'range') field.style.setProperty('--slider-progress', `${field.value}%`);
  });
  card.querySelectorAll('[data-percentage-label]').forEach(label => {
    const percentage = split.percentages[people[Number(label.dataset.percentageLabel)]];
    label.textContent = percentage == null ? '—' : `${percentage}%`;
  });
  const amounts = previewPercentageAmounts(appState.receipt.items[idx].paid_price, split.percentages, people);
  card.querySelectorAll('[data-share-price]').forEach(label => {
    const person = people[Number(label.dataset.sharePrice)];
    const amount = amounts[person];
    label.textContent = amount == null ? '—' : `€${amount.toFixed(2)}`;
  });
  const valid = isValidPercentages(split.percentages, people);
  const status = document.getElementById(`split-status-${idx}`);
  status.textContent = splitStatusText(split.percentages);
  status.classList.toggle('invalid', !valid);
  card.classList.toggle('assigned', valid);
  const badge = card.querySelector('.assignment-badge');
  badge.className = 'assignment-badge ' + (valid ? 'filled' : 'invalid');
  badge.textContent = valid ? 'Percentages' : 'Check split';
  document.querySelectorAll('.item-card').forEach((item, i) => item.classList.toggle('selected', i === idx));
  renderProgress();
  renderTotalsBar();
}

function selectItem(idx) {
  appState.selectedIdx = idx;
  document.querySelectorAll('.item-card').forEach((card, i) => card.classList.toggle('selected', i === idx));
  scrollToSelected();
}

function assignSelected(person) {
  const idx = appState.selectedIdx;
  if (idx < 0 || idx >= appState.receipt.items.length) return;

  appState.assigned[idx] = person;
  if (appState.splits[idx].enabled) {
    appState.splits[idx].enabled = false;
    rememberSplit(idx);
  }
  recordAssignment(appState.receipt.items[idx].name, person);

  const total = appState.receipt.items.length;
  let next = -1;
  for (let i = idx + 1; i < total; i++) { if (!itemIsAssigned(i)) { next = i; break; } }
  if (next === -1) for (let i = 0; i < idx; i++) { if (!itemIsAssigned(i)) { next = i; break; } }
  if (next === -1) next = Math.min(idx + 1, total - 1);

  appState.selectedIdx = next;
  renderProgress();
  renderTotalsBar();
  renderItemsList();
  scrollToSelected();
}

function scrollToSelected() {
  const cards = document.querySelectorAll('.item-card');
  const card  = cards[appState.selectedIdx];
  if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ── Settle Screen ─────────────────────────────
function goSettle() {
  const invalidIdx = appState.splits.findIndex(split => split.enabled && !isValidPercentages(split.percentages, getPeople()));
  if (invalidIdx !== -1) {
    selectItem(invalidIdx);
    document.getElementById(`split-controls-${invalidIdx}`).querySelector('input').focus({ preventScroll: true });
    return;
  }
  const common = getCommon();
  appState.assigned = appState.assigned.map(a => a === null ? common : a);
  appState.payer = appState.payer || getPeople()[0];
  showScreen('settle');
  renderSettleScreen();
}

function renderSettleScreen() { renderPayerButtons(); renderSettlement(); }

function renderPayerButtons() {
  const people = getPeople();
  renderGrid(document.getElementById('payer-buttons'), people.map((name, i) => ({
    name,
    color: SLOT_COLORS[i],
    selected: appState.payer === name,
    callback: () => selectPayer(name),
    btnClass: 'payer-btn',
  })), 3);
}

function selectPayer(name) { appState.payer = name; renderSettleScreen(); }

function renderSettlement() {
  const r      = appState.receipt;
  const people = getPeople();
  const common = getCommon();
  const colors = getColors();
  const payer  = appState.payer;
  const n      = people.length;

  const { settlements, commonItems, commonTotal } = computeSettlement(r, appState.assigned, people, common, appState.splits);

  let html = '';
  settlements.filter(s => s.person !== payer).forEach(({ person, ownItems, ownTotal, commonShare, owes }) => {
    const color = colors[person];
    html += `
      <div class="settlement-card">
        <div class="settlement-header" style="background:${color}18">
          <h3 style="color:${color}">${escapeHtml(person)} owes ${escapeHtml(payer)}</h3>
          <span class="owes-amount" style="color:${color}">€${owes.toFixed(2)}</span>
        </div>
        <div class="settlement-items">
          ${ownItems.map(it => `
            <div class="settle-item-row">
              <span class="settle-item-name">${escapeHtml(it.name)}${it.percentage != null ? ` <span class="settle-percentage">(${it.percentage}%)</span>` : ''}</span>
              <span class="settle-item-price">€${it.price.toFixed(2)}</span>
            </div>`).join('')}
          ${ownItems.length ? `<div class="settle-subtotal"><span>Own subtotal</span><span>€${ownTotal.toFixed(2)}</span></div>` : ''}
          ${commonShare ? `<div class="settle-common"><span>Shared items split (÷${n})</span><span>€${commonShare.toFixed(2)}</span></div>` : ''}
        </div>
      </div>`;
  });

  if (commonItems.length > 0) {
    html += `
      <div class="section-title">Shared items</div>
      <div class="settlement-card">
        <div class="settlement-items">
          ${commonItems.map(it => `
            <div class="settle-item-row">
              <span class="settle-item-name">${escapeHtml(it.name)}</span>
              <span class="settle-item-price">€${it.price.toFixed(2)}</span>
            </div>`).join('')}
          <div class="settle-subtotal"><span>Shared total</span><span>€${commonTotal.toFixed(2)}</span></div>
        </div>
      </div>`;
  }

  document.getElementById('settle-content').innerHTML = html;
  document.getElementById('settle-hint').innerHTML = settlements
    .filter(s => s.person !== payer)
    .map(s => `<strong>${escapeHtml(s.person)}</strong> pays €${s.owes.toFixed(2)} to <strong>${escapeHtml(payer)}</strong>`)
    .join(' &nbsp;·&nbsp; ');
}

// ── Modal close on overlay click ──────────────
document.getElementById('settings-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSettings();
});

enhanceSliderHaptics(document.getElementById('items-list'));

// Leave room for all the buttons, including when more people are added.
new ResizeObserver(entries => {
  const height = entries[0].target.getBoundingClientRect().height;
  if (height > 0) document.getElementById('items-list').style.marginBottom = `${height + 16}px`;
}).observe(document.querySelector('#screen-assign .fab-bar'));

// Expose functions called from HTML onclick attributes
Object.assign(window, {
  handleParse, selectItem, assignSelected, toggleItemSplit, normalizeItemSplit, updateItemPercentage, goBack, goSettle, goAssign, startOver,
  openSettings, closeSettings, saveSettings, addSettingsPerson, removeSettingsPerson, selectPayer,
});
