// Derives take/timing analytics from a session's cards.
// Take timestamps are ms since the card's first tap; take N's own duration
// is the gap since the previous take (take 1's duration is its own timestamp).

function cardStats(card) {
  const takes = card.takes || [];
  const takeCount = takes.length;
  const durations = takes.map((t, i) => {
    const prev = i === 0 ? 0 : takes[i - 1].timestamp;
    return Math.max(0, t.timestamp - prev);
  });
  const totalTime = durations.reduce((a, b) => a + b, 0);
  const avgTimePerTake = takeCount ? totalTime / takeCount : 0;

  return {
    cardId: card.id,
    title: card.title,
    sectionBase: card.sectionBase || 'UNLABELLED',
    takeCount,
    durations,
    totalTime,
    avgTimePerTake,
  };
}

// Groups a flat list of per-card stats (from one session or many) by
// sectionBase, aggregating take counts and timing so patterns like "HEDGE
// cards average more retakes than CORE cards" are visible.
function groupBySection(perCardList) {
  const bySection = new Map();
  for (const c of perCardList) {
    const key = c.sectionBase || 'UNLABELLED';
    if (!bySection.has(key)) {
      bySection.set(key, { sectionBase: key, cardCount: 0, takeCount: 0, totalTime: 0 });
    }
    const bucket = bySection.get(key);
    bucket.cardCount += 1;
    bucket.takeCount += c.takeCount;
    bucket.totalTime += c.totalTime;
  }
  return Array.from(bySection.values())
    .map((b) => ({ ...b, avgTimePerTake: b.takeCount ? b.totalTime / b.takeCount : 0 }))
    .sort((a, b) => b.takeCount - a.takeCount);
}

function isLockedHeavy(card) {
  return (card.lockedSegments?.length || 0) >= (card.freeSegments?.length || 0);
}

export function computeSessionStats(session) {
  const cards = session.cards || [];
  const perCard = cards.map(cardStats);

  const totalTakes = perCard.reduce((a, c) => a + c.takeCount, 0);
  const totalTime = perCard.reduce((a, c) => a + c.totalTime, 0);

  const withTakes = perCard.filter((c) => c.takeCount > 0);
  const mostRetakes = withTakes.length
    ? withTakes.reduce((a, b) => (b.takeCount > a.takeCount ? b : a))
    : null;
  const longestAvgTake = withTakes.length
    ? withTakes.reduce((a, b) => (b.avgTimePerTake > a.avgTimePerTake ? b : a))
    : null;

  let lockedHeavyTakes = 0;
  let freeHeavyTakes = 0;
  cards.forEach((card, i) => {
    const takeCount = perCard[i].takeCount;
    if (isLockedHeavy(card)) lockedHeavyTakes += takeCount;
    else freeHeavyTakes += takeCount;
  });

  return {
    totalTakes,
    totalTime,
    perCard,
    bySection: groupBySection(perCard),
    flagged: { mostRetakes, longestAvgTake },
    lockedVsFree: { lockedHeavyTakes, freeHeavyTakes },
  };
}

// Aggregates by-section stats across every session in history, so patterns
// (e.g. "HEDGE cards average more retakes than CORE cards") show up over
// time rather than being locked inside a single session's numbers.
export function computeCrossSessionSectionStats(sessions) {
  const allCardStats = (sessions || []).flatMap((s) => (s.cards || []).map(cardStats));
  return {
    sessionCount: (sessions || []).length,
    bySection: groupBySection(allCardStats),
  };
}

export function formatMs(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}
