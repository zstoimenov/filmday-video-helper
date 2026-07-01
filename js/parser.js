// Tolerant parser for the E2A scene-card script format.
// Recognizes card headers like "CARD: Title", "CARD 1:", "## Card 1", "1. Title"
// and tags lines starting with the lock/unlock emoji, plus IDEA:/ANCHORS: lines.

const CARD_HEADER_RE = /^\s*(?:#{1,3}\s*)?(?:CARD\s*\d*\s*[:.\-]?|(\d+)[.)])\s*(.*)$/i;
const LOCKED_RE = /^\s*🔒\s*(.*)$/;
const FREE_RE = /^\s*🔓\s*(.*)$/;
const IDEA_RE = /^\s*IDEA\s*[:\-]\s*(.*)$/i;
const ANCHORS_RE = /^\s*ANCHORS?\s*[:\-]\s*(.*)$/i;

function isCardHeader(line) {
  if (!line.trim()) return false;
  return CARD_HEADER_RE.test(line) && /card|^\s*\d+[.)]/i.test(line);
}

function splitIntoBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (isCardHeader(line)) {
      if (current) blocks.push(current);
      const match = line.match(CARD_HEADER_RE);
      const title = (match && match[2] && match[2].trim()) || '';
      current = { title, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      // Content before any recognized header - start an implicit first card.
      current = { title: '', lines: [line] };
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function parseBlock(block, index) {
  const locked = [];
  const free = [];
  let idea = '';
  let anchors = [];
  let title = block.title;

  for (const rawLine of block.lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const lockedMatch = line.match(LOCKED_RE);
    if (lockedMatch) {
      locked.push(lockedMatch[1].trim());
      continue;
    }
    const freeMatch = line.match(FREE_RE);
    if (freeMatch) {
      free.push(freeMatch[1].trim());
      continue;
    }
    const ideaMatch = line.match(IDEA_RE);
    if (ideaMatch) {
      idea = ideaMatch[1].trim();
      continue;
    }
    const anchorsMatch = line.match(ANCHORS_RE);
    if (anchorsMatch) {
      anchors = anchorsMatch[1]
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      continue;
    }
    // Unrecognized line: if we have no title yet, use it as the title.
    if (!title) {
      title = line;
    } else {
      // Treat stray lines as free-form delivery notes.
      free.push(line);
    }
  }

  if (!title) title = `Card ${index + 1}`;

  return {
    title,
    ideaText: idea,
    anchors,
    lockedSegments: locked,
    freeSegments: free,
  };
}

export function parseScript(rawText) {
  const text = (rawText || '').trim();
  if (!text) return [];

  const blocks = splitIntoBlocks(text);
  const cards = blocks
    .filter((b) => b.title || b.lines.some((l) => l.trim()))
    .map((b, i) => parseBlock(b, i));

  return cards.filter(
    (c) =>
      c.title ||
      c.ideaText ||
      c.anchors.length ||
      c.lockedSegments.length ||
      c.freeSegments.length
  );
}

export function buildCards(rawText) {
  let parsed = [];
  try {
    parsed = parseScript(rawText);
  } catch (e) {
    parsed = [];
  }

  if (!parsed.length) {
    // Fallback: whole pasted text becomes a single card so the user is never blocked.
    parsed = [
      {
        title: 'Card 1',
        ideaText: '',
        anchors: [],
        lockedSegments: [],
        freeSegments: rawText ? [rawText.trim()] : [],
      },
    ];
  }

  return parsed.map((c, i) => ({
    id: `card-${i}-${Math.random().toString(36).slice(2, 7)}`,
    order: i,
    title: c.title,
    ideaText: c.ideaText,
    anchors: c.anchors,
    lockedSegments: c.lockedSegments,
    freeSegments: c.freeSegments,
    takes: [],
  }));
}
