import { saveSession, getSession, getAllSessions, deleteSession, genId } from './db.js';
import { buildCards, extractTitleDate } from './parser.js';
import { computeSessionStats, computeCrossSessionSectionStats, formatMs } from './analytics.js';
import { exportSessionJSON, exportSessionCSV } from './export.js';
import { APP_VERSION } from './version.js';
import { getSectionColor } from './sections.js';

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
  if (name === 'insights') renderInsights();
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
document.getElementById('btn-insights').addEventListener('click', () => navigate('insights'));

// ---------- NEW SESSION ----------

function renderNew() {
  showView('new');
  document.getElementById('session-title').value = '';
  document.getElementById('script-input').value = '';
}

// The v4 paste-block wrapper always carries the episode title and air date
// in the same spot, so the title field fills itself in from the pasted
// script instead of being typed by hand. Older pastes without that wrapper
// leave whatever the user already typed alone.
document.getElementById('script-input').addEventListener('input', (e) => {
  const { episodeNumber, title, date } = extractTitleDate(e.target.value);
  if (!title) return;
  const titleField = document.getElementById('session-title');
  titleField.value = [episodeNumber ? `Ep ${episodeNumber} — ${title}` : title, date].filter(Boolean).join(' · ');
});

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

  const unrecognizedCount = cards.filter((c) => c.sectionRecognized === false).length;
  const formatWarningCount = cards.filter((c) => c.formatWarning).length;
  if (unrecognizedCount > 0 || formatWarningCount > 0) {
    const parts = [];
    if (unrecognizedCount > 0) {
      parts.push(
        unrecognizedCount === 1
          ? '1 card has an unrecognised section label.'
          : `${unrecognizedCount} cards have unrecognised section labels.`
      );
    }
    if (formatWarningCount > 0) {
      parts.push(
        formatWarningCount === 1
          ? '1 card has an unexpected format (not a single locked/free beat).'
          : `${formatWarningCount} cards have an unexpected format (not a single locked/free beat).`
      );
    }
    document.getElementById('section-warning-text').textContent = parts.join(' ');
    document.getElementById('section-warning-banner').hidden = false;
  }
});

document.getElementById('btn-dismiss-warning').addEventListener('click', () => {
  document.getElementById('section-warning-banner').hidden = true;
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

function renderFilming() {
  showView('filming');
  document.getElementById('section-warning-banner').hidden = true;
  renderCurrentCard();
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
  const ideaBadgeEl = document.getElementById('card-idea-badge');
  ideaBadgeEl.textContent = card.ideaText ? 'IDEA' : '';

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

  // Tone and b-roll share one rounded box (same visual format as the
  // location pill) right under it, instead of at the bottom of the card,
  // but each note still gets its own line within that box.
  const notesEl = document.getElementById('card-notes');
  const noteParts = [
    ...(card.toneNotes || []).map((t) => `🎵 ${t}`),
    ...(card.brollNotes || []).map((b) => `📷 ${b}`),
  ];
  notesEl.innerHTML = noteParts.map((p) => escapeHtml(p)).join('<br>');

  renderLockFreeIndicator(card, 'card-meta-lockfree');
  renderSectionBadge(card);
  renderTakeLog(card);
  updateTakeButton(card);

  document.getElementById('btn-end-session').hidden = !isLast;

  // Re-derive the timer baseline from this card's last take every time it's shown,
  // so jumping between cards (nav strip, swipe, revisiting) never produces a
  // negative or inflated gap for the next take logged on it.
  cardStartTime = card.takes.length ? Date.now() - card.takes[card.takes.length - 1].timestamp : null;
}

function renderCardNav() {
  const nav = document.getElementById('card-nav');
  nav.innerHTML = '';
  let currentPill = null;
  currentSession.cards.forEach((card, i) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'card-nav-pill';
    if (i === currentCardIndex) {
      pill.classList.add('current');
      currentPill = pill;
    } else {
      // The current pill keeps its solid orange "you are here" fill; every
      // other pill is tinted by its section so the strip reads as a map of
      // the script's structure at a glance.
      const color = getSectionColor(card.sectionBase);
      pill.style.borderColor = color;
      pill.style.color = color;
    }
    if (card.takes.length) pill.classList.add('has-takes');
    pill.textContent = i + 1;
    pill.addEventListener('click', () => jumpToCard(i));
    nav.appendChild(pill);
  });
  // Keep the active page number in view as the current card changes, so it
  // never scrolls off the edge of the horizontally-scrolling strip.
  if (currentPill) {
    currentPill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function renderSectionBadge(card) {
  const wrap = document.getElementById('card-section-badge');
  wrap.innerHTML = '';
  const badge = document.createElement('span');
  const color = getSectionColor(card.sectionBase);
  const label = card.section || card.sectionBase || 'UNLABELLED';
  badge.className = 'section-badge';
  if (card.sectionRecognized === false || card.formatWarning) badge.classList.add('unrecognized');
  badge.style.color = color;
  badge.style.borderColor = color;
  badge.textContent = label;
  wrap.appendChild(badge);
}

function renderLockFreeIndicator(card, elementId) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';
  if ((card.lockedSegments || []).length) {
    const chip = document.createElement('span');
    chip.className = 'lf-chip lf-locked';
    chip.textContent = '🔒 LOCKED';
    el.appendChild(chip);
  }
  // A v3/v4 FREE beat's content is its IDEA/ANCHORS, not freeSegments text
  // (that stays empty), so the chip has to key off ideaText too - otherwise
  // it never shows for the current script format at all.
  if ((card.freeSegments || []).length || card.ideaText) {
    const chip = document.createElement('span');
    chip.className = 'lf-chip lf-free';
    chip.textContent = '🔓 UNLOCKED';
    el.appendChild(chip);
  }
}

function jumpToCard(i) {
  if (i === currentCardIndex) return;
  currentCardIndex = i;
  renderCurrentCard();
}

function renderTakeLog(card) {
  const log = document.getElementById('take-log');
  log.innerHTML = '';
  let lastChip = null;
  card.takes.forEach((t) => {
    const chip = document.createElement('span');
    chip.className = 'take-chip';
    chip.textContent = `Take ${t.takeNumber} · ${formatMs(t.timestamp)}`;
    log.appendChild(chip);
    lastChip = chip;
  });
  // Always reveal the most recent take instead of leaving the strip
  // scrolled wherever it happened to be for the previous card.
  if (lastChip) {
    lastChip.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
  }
}

function updateTakeButton(card) {
  const btn = document.getElementById('btn-take-mini');
  btn.textContent = card.takes.length ? `Take ${card.takes.length + 1}` : 'Start';
  btn.classList.toggle('recording', card.takes.length > 0);
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

document.getElementById('btn-take-mini').addEventListener('click', handleTake);

async function goToNextCard() {
  if (currentCardIndex < currentSession.cards.length - 1) {
    currentCardIndex += 1;
    renderCurrentCard();
    await saveSession(currentSession);
  }
}

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

// Gestures on the card content: swipe left/right to change cards (primary
// navigation), long-press to start/log a take, double-tap to log a take
// once already recording. Bound once at startup - currentSession/
// currentCardIndex are read live via closures, so a single long-lived
// listener set stays correct across every session opened afterwards.
function setupGestures() {
  const el = document.getElementById('filming-card');

  const LONG_PRESS_MS = 550;
  const TAP_MAX_MS = 300;
  const DOUBLE_TAP_MAX_MS = 350;
  const MOVE_THRESHOLD = 12;
  const SWIPE_MIN_DX = 60;
  const SWIPE_MAX_DY = 60;

  let startX = null;
  let startY = null;
  let startTime = 0;
  let moved = false;
  let longPressTimer = null;
  let longPressFired = false;
  let lastTapTime = 0;
  let lastTapX = null;
  let lastTapY = null;

  const clearLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || !currentSession) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      moved = false;
      longPressFired = false;
      clearLongPress();
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        handleTake();
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      if (startX === null) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > MOVE_THRESHOLD || Math.abs(t.clientY - startY) > MOVE_THRESHOLD) {
        moved = true;
        clearLongPress();
      }
    },
    { passive: true }
  );

  el.addEventListener(
    'touchend',
    (e) => {
      clearLongPress();
      if (startX === null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const duration = Date.now() - startTime;
      const wasLongPress = longPressFired;
      startX = null;
      startY = null;
      longPressFired = false;

      if (wasLongPress) return;

      if (!moved && duration < TAP_MAX_MS) {
        const now = Date.now();
        const isDoubleTap =
          lastTapTime &&
          now - lastTapTime < DOUBLE_TAP_MAX_MS &&
          lastTapX !== null &&
          Math.abs(t.clientX - lastTapX) < MOVE_THRESHOLD * 2 &&
          Math.abs(t.clientY - lastTapY) < MOVE_THRESHOLD * 2;

        if (isDoubleTap) {
          lastTapTime = 0;
          const card = currentSession.cards[currentCardIndex];
          if (card.takes.length) handleTake();
        } else {
          lastTapTime = now;
          lastTapX = t.clientX;
          lastTapY = t.clientY;
        }
        return;
      }

      if (moved && Math.abs(dx) >= SWIPE_MIN_DX && Math.abs(dy) <= SWIPE_MAX_DY) {
        const cards = currentSession.cards;
        if (dx < 0 && currentCardIndex < cards.length - 1) {
          goToNextCard();
        } else if (dx > 0 && currentCardIndex > 0) {
          jumpToCard(currentCardIndex - 1);
        }
      }
    },
    { passive: true }
  );
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

  renderSectionStatRows(document.getElementById('summary-by-section'), stats.bySection);

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

// Shared by the per-session "By Section" breakdown and the cross-session
// Insights view - both show the same shape of aggregated section stats.
function renderSectionStatRows(container, bySection) {
  container.innerHTML = '';
  if (!bySection.length) {
    container.innerHTML = '<p class="empty-state">No section data yet.</p>';
    return;
  }
  bySection.forEach((s) => {
    const color = getSectionColor(s.sectionBase);
    const row = document.createElement('div');
    row.className = 'section-stat-row';
    row.style.borderLeftColor = color;
    row.innerHTML = `
      <span class="ss-name" style="color:${color}">${escapeHtml(s.sectionBase)}</span>
      <span class="ss-meta">${s.cardCount} card${s.cardCount === 1 ? '' : 's'} &middot; ${s.takeCount} takes &middot; avg ${formatMs(s.avgTimePerTake)}/take</span>
    `;
    container.appendChild(row);
  });
}

// ---------- SECTION INSIGHTS (cross-session) ----------

async function renderInsights() {
  showView('insights');
  const sessions = await getAllSessions();
  const stats = computeCrossSessionSectionStats(sessions);

  document.getElementById('insights-summary').textContent = stats.sessionCount
    ? `Across ${stats.sessionCount} session${stats.sessionCount === 1 ? '' : 's'}.`
    : 'No sessions yet.';

  renderSectionStatRows(document.getElementById('insights-by-section'), stats.bySection);
}

// ---------- INIT ----------

setupGestures();
renderHome();
