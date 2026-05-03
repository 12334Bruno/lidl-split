import { parseLidlText } from './parser.js';
import { round2, computeRunningTotals, computeSettlement, splitEqually } from './money.js';

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
  document.getElementById('settings-people-list').innerHTML = people.map((p, i) => `
    <div class="settings-person-row">
      <span class="settings-person-num" style="color:${SLOT_COLORS[i % (SLOT_COLORS.length-1)]}">${i + 1}</span>
      <input type="text" class="settings-person-input" value="${p}" placeholder="Name">
      ${people.length > 2
        ? `<button class="settings-remove-btn" onclick="removeSettingsPerson(${i})">✕</button>`
        : '<span style="width:28px"></span>'}
    </div>`).join('');
}

function addSettingsPerson() {
  const current = getSettingsPeopleFromForm();
  if (current.length >= 8) return;
  renderSettingsPeople([...current, '']);
  const inputs = document.querySelectorAll('.settings-person-input');
  inputs[inputs.length - 1].focus();
}

function removeSettingsPerson(idx) {
  const current = getSettingsPeopleFromForm();
  current.splice(idx, 1);
  renderSettingsPeople(current);
}

function getSettingsPeopleFromForm() {
  return Array.from(document.querySelectorAll('.settings-person-input')).map(el => el.value.trim());
}

function closeSettings() { document.getElementById('settings-modal').classList.remove('open'); }

function saveSettings() {
  const raw    = getSettingsPeopleFromForm();
  const people = raw.map((n, i) => n || `Person ${i + 1}`);
  if (people.length < 2) { alert('You need at least 2 people.'); return; }
  const common = document.getElementById('setting-common').value.trim() || 'Common';

  const oldPeople = getPeople();
  const oldCommon = getCommon();
  const nameMap   = {};
  oldPeople.forEach((oldName, i) => { if (people[i]) nameMap[oldName] = people[i]; });
  nameMap[oldCommon] = common;

  if (appState.assigned) {
    appState.assigned = appState.assigned.map(a => (a && nameMap[a]) ? nameMap[a] : a);
  }
  if (appState.payer && nameMap[appState.payer]) {
    appState.payer = nameMap[appState.payer];
  }

  localStorage.setItem('people', JSON.stringify(people));
  localStorage.setItem('common', common);
  closeSettings();
  if (appState.screen === 'assign') renderAssignScreen();
  if (appState.screen === 'settle') renderSettleScreen();
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
  const total = Object.values(bucket).reduce((a, b) => a + b, 0);
  const [name, count] = Object.entries(bucket).sort((a, b) => b[1] - a[1])[0];
  return { name, conf: count / total };
}

// ── App State ─────────────────────────────────
const appState = { screen: 'paste', receipt: null, assigned: [], selectedIdx: 0, payer: null };

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
    appState.selectedIdx = appState.assigned.findIndex(a => a === null);
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
    <div><div class="store">${r.store || 'Lidl'}</div><div class="date">${r.date || ''}</div></div>
    <div class="totals"><div class="total-label">Total paid</div><div class="total-amount">€${r.total_net.toFixed(2)}</div></div>`;
}

function renderProgress() {
  const total = appState.assigned.length;
  const done  = appState.assigned.filter(Boolean).length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  document.getElementById('progress-text').textContent = `${done} of ${total} assigned`;
  document.getElementById('progress-pct').textContent  = pct + '%';
  document.getElementById('progress-fill').style.width = pct + '%';
}

function renderTotalsBar() {
  const names   = getAllNames();
  const colors  = getColors();
  const totals  = computeRunningTotals(appState.receipt.items, appState.assigned);
  names.forEach(n => { if (totals[n] == null) totals[n] = 0; });
  const discount = appState.receipt.discounts.reduce((s, d) => s + d.amount, 0);
  const many = names.length > 4;
  document.getElementById('totals-bar').innerHTML =
    names.map(n => `
      <div class="totals-chip">
        <span class="chip-label" style="color:${colors[n]}">${many && n.length > 4 ? n.slice(0,3) : n}</span>
        <span class="chip-value">€${totals[n].toFixed(2)}</span>
      </div>`).join('') +
    (discount !== 0 ? `<div class="totals-chip">
        <span class="chip-label" style="color:var(--green-disc)">Disc.</span>
        <span class="chip-value" style="color:var(--green-disc)">${discount.toFixed(2)}</span>
      </div>` : '');
}

function renderPersonButtons() {
  const people = getPeople();
  const common = getCommon();
  const colors = getColors();
  const few    = people.length <= 2;
  const allForBtn = [...people, common];
  const total  = allForBtn.length;

  const maxCols = 5;
  const cols    = Math.min(total, maxCols);
  const remainder    = total > cols ? total % cols : 0;
  const lastRowStart = remainder > 0 ? Math.floor((cols - remainder) / 2) + 1 : null;

  const btns = allForBtn.map((name, i) => {
    const isCommon = i === people.length;
    const color    = colors[name];
    const isFirstOfLastRow = lastRowStart !== null && i === total - remainder;
    const gridStyle = isFirstOfLastRow ? `grid-column-start:${lastRowStart};` : '';

    if (few) {
      return `<button class="person-btn" style="background:${color};${gridStyle}" onclick="assignSelected('${name.replace(/'/g,"\\'")}')"><span class="btn-name">${name}</span></button>`;
    } else {
      const num  = isCommon ? '★' : (i + 1);
      const abbr = name.length > 3 ? name.slice(0, 3) : name;
      return `<button class="person-btn" style="background:${color};${gridStyle}" onclick="assignSelected('${name.replace(/'/g,"\\'")}')"><span class="btn-num">${num}</span><span class="btn-abbr">${abbr}</span></button>`;
    }
  }).join('');

  const container = document.getElementById('person-btns');
  container.innerHTML = btns;
  container.className = 'person-btns' + (few ? ' few' : '');
  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}

function renderItemsList() {
  const colors = getColors();
  const r = appState.receipt;
  let html = '';

  r.items.forEach((item, i) => {
    const person     = appState.assigned[i];
    const isSelected = i === appState.selectedIdx;
    const color      = person ? colors[person] : 'transparent';
    const sugg       = getSuggestion(item.name);
    const wt         = item.weight_kg;
    const detail     = wt
      ? `${wt.toFixed(3)} kg × €${item.unit_price_per_kg?.toFixed(2)}/kg`
      : item.quantity > 1 ? `${item.quantity} × €${item.unit_price.toFixed(2)}` : '';

    const badgeHtml = person
      ? `<div class="assignment-badge filled" style="--person-color:${colors[person]};background:${colors[person]}">${getPeople().length > 2 ? person.slice(0,3) : person}</div>`
      : (sugg.name && sugg.conf >= 0.5)
        ? `<div class="assignment-badge empty">→ ${getPeople().length > 2 ? sugg.name.slice(0,3) : sugg.name}</div>`
        : `<div class="assignment-badge empty">—</div>`;

    html += `
      <div class="item-card ${person ? 'assigned' : ''} ${isSelected ? 'selected' : ''}"
           style="--person-color:${color}"
           onclick="selectItem(${i})">
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          ${detail ? `<div class="item-detail">${detail}</div>` : ''}
        </div>
        <div class="item-right">
          <div class="item-price">€${item.paid_price.toFixed(2)}</div>
          ${badgeHtml}
        </div>
      </div>`;
  });

  if (r.discounts.length > 0) {
    html += `<div class="section-title">Discounts &amp; returns</div>`;
    r.discounts.forEach(d => {
      html += `<div class="discount-row">
        <span class="d-name">${d.name}</span>
        <span class="d-amount">€${d.amount.toFixed(2)}</span>
      </div>`;
    });
  }

  document.getElementById('items-list').innerHTML = html;
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
  recordAssignment(appState.receipt.items[idx].name, person);

  const total = appState.receipt.items.length;
  let next = -1;
  for (let i = idx + 1; i < total; i++) { if (!appState.assigned[i]) { next = i; break; } }
  if (next === -1) for (let i = 0; i < idx; i++) { if (!appState.assigned[i]) { next = i; break; } }
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
  const common = getCommon();
  appState.assigned = appState.assigned.map(a => a === null ? common : a);
  appState.payer = appState.payer || getPeople()[0];
  showScreen('settle');
  renderSettleScreen();
}

function renderSettleScreen() { renderPayerButtons(); renderSettlement(); }

function renderPayerButtons() {
  const people  = getPeople();
  const total   = people.length;
  const maxCols = 5;
  const cols    = Math.min(total, maxCols);
  const remainder    = total > cols ? total % cols : 0;
  const lastRowStart = remainder > 0 ? Math.floor((cols - remainder) / 2) + 1 : null;

  const html = people.map((p, i) => {
    const isFirstOfLastRow = lastRowStart !== null && i === total - remainder;
    const gridStyle = isFirstOfLastRow ? `grid-column-start:${lastRowStart};` : '';
    const sel = appState.payer === p;
    return `<button class="payer-btn ${sel ? 'selected' : ''}"
      style="${sel ? `background:${SLOT_COLORS[i]};border-color:${SLOT_COLORS[i]};` : ''}${gridStyle}"
      onclick="selectPayer('${p}')">${p}</button>`;
  }).join('');

  const container = document.getElementById('payer-buttons');
  container.innerHTML = html;
  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}

function selectPayer(name) { appState.payer = name; renderSettleScreen(); }

function renderSettlement() {
  const r      = appState.receipt;
  const people = getPeople();
  const common = getCommon();
  const colors = getColors();
  const payer  = appState.payer;
  const n      = people.length;

  const { settlements, commonItems, commonTotal } = computeSettlement(r, appState.assigned, people, common);

  let html = '';
  settlements.filter(s => s.person !== payer).forEach(({ person, ownItems, ownTotal, commonShare, owes }) => {
    const color = colors[person];
    html += `
      <div class="settlement-card">
        <div class="settlement-header" style="background:${color}18">
          <h3 style="color:${color}">${person} owes ${payer}</h3>
          <span class="owes-amount" style="color:${color}">€${owes.toFixed(2)}</span>
        </div>
        <div class="settlement-items">
          ${ownItems.map(it => `
            <div class="settle-item-row">
              <span class="settle-item-name">${it.name}</span>
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
              <span class="settle-item-name">${it.name}</span>
              <span class="settle-item-price">€${it.price.toFixed(2)}</span>
            </div>`).join('')}
          <div class="settle-subtotal"><span>Shared total</span><span>€${commonTotal.toFixed(2)}</span></div>
        </div>
      </div>`;
  }

  document.getElementById('settle-content').innerHTML = html;
  document.getElementById('settle-hint').innerHTML = settlements
    .filter(s => s.person !== payer)
    .map(s => `<strong>${s.person}</strong> pays €${s.owes.toFixed(2)} to <strong>${payer}</strong>`)
    .join(' &nbsp;·&nbsp; ');
}

// ── Modal close on overlay click ──────────────
document.getElementById('settings-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSettings();
});

// Expose functions called from HTML onclick attributes
Object.assign(window, {
  handleParse, selectItem, assignSelected, goBack, goSettle, goAssign, startOver,
  openSettings, closeSettings, saveSettings, addSettingsPerson, removeSettingsPerson, selectPayer,
});