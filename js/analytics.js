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
    takeCount,
    durations,
    totalTime,
    avgTimePerTake,
  };
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
    flagged: { mostRetakes, longestAvgTake },
    lockedVsFree: { lockedHeavyTakes, freeHeavyTakes },
  };
}

export function formatMs(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}
