import { saveSession, getSession, getAllSessions, deleteSession, genId } from './db.js';
import { buildCards } from './parser.js';
import { computeSessionStats, formatMs } from './analytics.js';
import { exportSessionJSON, exportSessionCSV } from './export.js';
import { APP_VERSION } from './version.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
    if (!reg) return;
    // Force a fresh update check now and whenever the app regains focus, instead
    // of waiting on the browser's own throttled background check.
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  });

  // skipWaiting + clients.claim in sw.js mean a new worker takes control as soon
  // as it's installed; reload immediately so the new version is actually used.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

document.getElementById('app-version').textContent = APP_VERSION;

const views = document.querySelectorAll('.view');
let currentSession = null; // in-memory working session during filming
let currentCardIndex = 0;
let cardStartTime = null; // transient, not persisted

function showView(name) {
  views.forEach((v) => {
    v.hidden = v.dataset.view !== name;
  });
}

document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.nav));
});

function navigate(name, ctx) {
  if (name === 'home') renderHome();
  if (name === 'new') renderNew();
  if (name === 'filming') renderFilming();
  if (name === 'summary') renderSummary(ctx);
}

// ---------- HOME ----------

async function renderHome() {
  showView('home');
  const list = document.getElementById('session-list');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '';

  const sessions = await getAllSessions();
  empty.hidden = sessions.length > 0;

  for (const session of sessions) {
    const stats = computeSessionStats(session);
    const avgPerCard = session.cards.length
      ? stats.totalTime / session.cards.length
      : 0;

    const el = document.createElement('div');
    el.className = 'session-item';
    el.innerHTML = `
      <div class="session-item-row">
        <span class="s-status">${session.status === 'complete' ? 'Complete' : 'In progress'}</span>
        <button class="btn-delete" type="button" aria-label="Delete session">&times;</button>
      </div>
      <span class="s-title">${escapeHtml(session.title)}</span>
      <span class="s-meta">
        <span>${new Date(session.createdAt).toLocaleDateString()}</span>
        <span>${stats.totalTakes} takes</span>
        <span>avg ${formatMs(avgPerCard)}/card</span>
      </span>
    `;
    el.addEventListener('click', () => openSession(session.id));
    el.querySelector('.btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteSession(session.id, session.title);
    });
    list.appendChild(el);
  }
}

async function handleDeleteSession(id, title) {
  const confirmed = window.confirm(`Delete "${title}"? This cannot be undone.`);
  if (!confirmed) return;
  await deleteSession(id);
  renderHome();
}

async function openSession(id) {
  const session = await getSession(id);
  if (!session) return renderHome();
  currentSession = session;
  if (session.status === 'complete') {
    renderSummary(session);
  } else {
    currentCardIndex = 0;
    cardStartTime = null;
    navigate('filming');
  }
}

document.getElementById('btn-new-session').addEventListener('click', () => navigate('new'));

// ---------- NEW SESSION ----------

function renderNew() {
  showView('new');
  document.getElementById('session-title').value = '';
  document.getElementById('script-input').value = '';
}

document.getElementById('btn-parse').addEventListener('click', async () => {
  const titleInput = document.getElementById('session-title').value.trim();
  const scriptText = document.getElementById('script-input').value;

  const cards = buildCards(scriptText);
  const session = {
    id: genId(),
    title: titleInput || `Session ${new Date().toLocaleDateString()}`,
    createdAt: Date.now(),
    rawScriptText: scriptText,
    cards,
    status: 'in-progress',
  };

  await saveSession(session);
  currentSession = session;
  currentCardIndex = 0;
  cardStartTime = null;
  navigate('filming');
});

// ---------- FILMING ----------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function highlightAnchors(text, anchors) {
  if (!text) return '';
  let html = escapeHtml(text);
  for (const anchor of anchors || []) {
    if (!anchor) continue;
    const escaped = escapeHtml(anchor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    html = html.replace(re, '<span class="anchor-word">$1</span>');
  }
  return html;
}

function makeNoteLine(icon, text) {
  const div = document.createElement('div');
  div.className = 'note-line';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'note-icon';
  iconSpan.textContent = icon;
  div.appendChild(iconSpan);
  div.appendChild(document.createTextNode(text));
  return div;
}

function renderFilming() {
  showView('filming');
  renderCurrentCard();
  setupSwipe();
}

function renderCurrentCard() {
  const cards = currentSession.cards;
  const card = cards[currentCardIndex];
  const isLast = currentCardIndex === cards.length - 1;

  document.getElementById('card-progress').textContent = `${currentCardIndex + 1} / ${cards.length}`;
  document.getElementById('progress-bar-fill').style.width = `${((currentCardIndex + 1) / cards.length) * 100}%`;
  renderCardNav();
  document.getElementById('card-title').textContent = card.title;

  const locationEl = document.getElementById('card-location');
  locationEl.textContent = (card.locationNotes || []).length
    ? `📍 ${card.locationNotes.join(' · ')}`
    : '';
  const runtimeEl = document.getElementById('card-runtime');
  runtimeEl.textContent = card.estimatedRuntime ? `⏱ ~${card.estimatedRuntime}` : '';

  document.getElementById('card-locked').innerHTML = (card.lockedSegments || [])
    .map((seg) => highlightAnchors(seg, card.anchors))
    .join('<br><br>');

  document.getElementById('card-free').innerHTML = (card.freeSegments || [])
    .map((seg) => highlightAnchors(seg, card.anchors))
    .join('<br><br>');

  document.getElementById('card-idea').textContent = card.ideaText || '';

  const anchorsEl = document.getElementById('card-anchors');
  anchorsEl.innerHTML = '';
  (card.anchors || []).forEach((a) => {
    const chip = document.createElement('span');
    chip.className = 'anchor-chip';
    chip.textContent = a;
    anchorsEl.appendChild(chip);
  });

  const notesEl = document.getElementById('card-notes');
  notesEl.innerHTML = '';
  (card.toneNotes || []).forEach((t) => {
    notesEl.appendChild(makeNoteLine('🎵', t));
  });
  (card.brollNotes || []).forEach((b) => {
    notesEl.appendChild(makeNoteLine('📷', b));
  });

  renderTakeLog(card);
  updateTakeButton(card);

  document.getElementById('btn-next-card').hidden = isLast;
  document.getElementById('btn-end-session').hidden = !isLast;

  // Re-derive the timer baseline from this card's last take every time it's shown,
  // so jumping between cards (nav strip, swipe, revisiting) never produces a
  // negative or inflated gap for the next take logged on it.
  cardStartTime = card.takes.length ? Date.now() - card.takes[card.takes.length - 1].timestamp : null;
}

function renderCardNav() {
  const nav = document.getElementById('card-nav');
  nav.innerHTML = '';
  currentSession.cards.forEach((card, i) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'card-nav-pill';
    if (i === currentCardIndex) pill.classList.add('current');
    if (card.takes.length) pill.classList.add('has-takes');
    pill.textContent = i + 1;
    pill.addEventListener('click', () => jumpToCard(i));
    nav.appendChild(pill);
  });
}

function jumpToCard(i) {
  if (i === currentCardIndex) return;
  currentCardIndex = i;
  renderCurrentCard();
}

function renderTakeLog(card) {
  const log = document.getElementById('take-log');
  log.innerHTML = '';
  card.takes.forEach((t) => {
    const chip = document.createElement('span');
    chip.className = 'take-chip';
    chip.textContent = `Take ${t.takeNumber} · ${formatMs(t.timestamp)}`;
    log.appendChild(chip);
  });
}

function updateTakeButton(card) {
  const label = card.takes.length ? `Take ${card.takes.length + 1}` : 'Start';
  document.getElementById('btn-take').textContent = label;
  document.getElementById('btn-take-mini').textContent = label;
}

async function handleTake() {
  const card = currentSession.cards[currentCardIndex];
  if (!card.takes.length) {
    cardStartTime = Date.now();
    card.takes.push({ takeNumber: 1, timestamp: 0 });
  } else {
    if (cardStartTime === null) cardStartTime = Date.now();
    card.takes.push({ takeNumber: card.takes.length + 1, timestamp: Date.now() - cardStartTime });
  }
  renderTakeLog(card);
  updateTakeButton(card);
  renderCardNav();
  await saveSession(currentSession);
}

document.getElementById('btn-take').addEventListener('click', handleTake);
document.getElementById('btn-take-mini').addEventListener('click', handleTake);

document.getElementById('btn-next-card').addEventListener('click', async () => {
  if (currentCardIndex < currentSession.cards.length - 1) {
    currentCardIndex += 1;
    renderCurrentCard();
    await saveSession(currentSession);
  }
});

document.getElementById('btn-end-session').addEventListener('click', async () => {
  currentSession.status = 'complete';
  await saveSession(currentSession);
  navigate('summary', currentSession);
});

async function resumeAtCard(index) {
  currentSession.status = 'in-progress';
  await saveSession(currentSession);
  currentCardIndex = index;
  navigate('filming');
}

document.getElementById('btn-resume-session').addEventListener('click', () => {
  resumeAtCard(currentSession.cards.length - 1);
});

function setupSwipe() {
  const el = document.getElementById('filming-card');
  let startX = null;
  let startY = null;

  el.ontouchstart = (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  };
  el.ontouchend = (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    startX = null;
    startY = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 60) return;
    const cards = currentSession.cards;
    if (dx < 0 && currentCardIndex < cards.length - 1) {
      document.getElementById('btn-next-card').click();
    } else if (dx > 0 && currentCardIndex > 0) {
      jumpToCard(currentCardIndex - 1);
    }
  };
}

// ---------- SUMMARY ----------

function renderSummary(session) {
  currentSession = session || currentSession;
  const s = currentSession;
  showView('summary');

  document.getElementById('summary-title').textContent = s.title;

  const stats = computeSessionStats(s);

  document.getElementById('summary-totals').innerHTML = `
    <div class="stat-box"><div class="stat-value">${stats.totalTakes}</div><div class="stat-label">Total Takes</div></div>
    <div class="stat-box"><div class="stat-value">${formatMs(stats.totalTime)}</div><div class="stat-label">Total Filming Time</div></div>
  `;

  const flaggedEl = document.getElementById('summary-flagged');
  flaggedEl.innerHTML = '';
  if (stats.flagged.mostRetakes) {
    flaggedEl.innerHTML += `
      <div class="flag-item"><span class="flag-label">Most Retakes</span><br>
      ${escapeHtml(stats.flagged.mostRetakes.title)} &mdash; ${stats.flagged.mostRetakes.takeCount} takes</div>`;
  }
  if (stats.flagged.longestAvgTake) {
    flaggedEl.innerHTML += `
      <div class="flag-item"><span class="flag-label">Longest Avg Time / Take</span><br>
      ${escapeHtml(stats.flagged.longestAvgTake.title)} &mdash; ${formatMs(stats.flagged.longestAvgTake.avgTimePerTake)}</div>`;
  }
  if (!stats.flagged.mostRetakes && !stats.flagged.longestAvgTake) {
    flaggedEl.innerHTML = '<p class="empty-state">No takes recorded yet.</p>';
  }

  const { lockedHeavyTakes, freeHeavyTakes } = stats.lockedVsFree;
  const totalLF = lockedHeavyTakes + freeHeavyTakes || 1;
  document.getElementById('summary-lockedfree').innerHTML = `
    <div class="lf-bar-row">
      <span>LOCKED-heavy (${lockedHeavyTakes})</span>
      <span class="lf-bar-track"><span class="lf-bar-fill" style="width:${(lockedHeavyTakes / totalLF) * 100}%"></span></span>
    </div>
    <div class="lf-bar-row">
      <span>FREE-heavy (${freeHeavyTakes})</span>
      <span class="lf-bar-track"><span class="lf-bar-fill" style="width:${(freeHeavyTakes / totalLF) * 100}%"></span></span>
    </div>
  `;

  const cardsEl = document.getElementById('summary-cards');
  cardsEl.innerHTML = '';
  stats.perCard.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'summary-card-row';
    row.innerHTML = `
      <span class="sc-title">${escapeHtml(c.title)}</span>
      <span class="sc-meta">${c.takeCount} takes &middot; total ${formatMs(c.totalTime)} &middot; avg ${formatMs(c.avgTimePerTake)}/take</span>
    `;
    row.addEventListener('click', () => resumeAtCard(i));
    cardsEl.appendChild(row);
  });

  document.getElementById('btn-export-json').onclick = () => exportSessionJSON(s);
  document.getElementById('btn-export-csv').onclick = () => exportSessionCSV(s);
}

// ---------- INIT ----------

renderHome();
