// Tolerant parser for the E2A scene-card script format.
// Recognizes card headers like "CARD: Title", "CARD 1:", "## Card 1", "1. Title",
// and tags segments introduced by 🔒/🔓, plus IDEA:/ANCHORS: lines. Handles both
// single-line segments ("🔒 Say this exact line.") and label+body segments
// ("🔒 HOOK:\nSay this exact line.") where the body runs until a blank line or
// the next recognized marker. Production/staging notes (📍 location+shot, 🎵
// tone, 📷 b-roll) are captured as structured metadata rather than spoken
// text; decorative separator lines (including the standalone "---" that ends
// every card in the v2 script format) are dropped entirely - block splitting
// is driven by the header lines themselves, so the divider is a no-op.
//
// v2 headers additionally carry a SECTION code right after the card number:
// "## CARD 8 — CORE-2 Минутите" -> section "CORE-2", sectionBase "CORE",
// label "Минутите". SECTION is a closed set (see sections.js) but an
// unrecognised code is still parsed normally and just flagged, per spec.

import { KNOWN_SECTIONS } from './sections.js';

const STRONG_HEADER_RE = /^\s*(?:#{1,3}\s*)?CARD\b/i;
const SECTION_TOKEN_RE = /^([A-Z]{2,10})(-\d+)?\s+(.*)$/;
const LOCKED_RE = /^\s*🔒\s*(.*)$/;
const FREE_RE = /^\s*🔓\s*(.*)$/;
const IDEA_RE = /^\s*IDEA\s*[:\-]\s*(.*)$/i;
const ANCHORS_RE = /^\s*ANCHORS?\s*[:\-]\s*(.*)$/i;
const LOCATION_RE = /^\s*📍\s*(.*)$/;
const TONE_RE = /^\s*🎵\s*(?:TONE\s*[:\-]\s*)?(.*)$/i;
const BROLL_RE = /^\s*📷\s*(?:B-?ROLL\s*[:\-]\s*)?(.*)$/i;
const OTHER_NOTE_RE = /^\s*(?:🎥|🎬)/;
const SEPARATOR_RE = /^[-=─═_*]{3,}$/;
const RUNTIME_RE = /~\s*(\d+(?:\s*[-–]\s*\d+)?)\s*s(?:ec)?\.?\s*$/i;

// Pulls a trailing "~15s." / "~30-45s." estimate off a location line and
// returns the cleaned text plus the runtime (e.g. "15s" / "30-45s"), if any.
function extractRuntime(text) {
  const match = text.match(RUNTIME_RE);
  if (!match) return { text, runtime: null };
  return {
    text: text.slice(0, match.index).trim(),
    runtime: `${match[1].replace(/\s*[-–]\s*/, '-')}s`,
  };
}

function matchStrongHeader(line) {
  if (!STRONG_HEADER_RE.test(line)) return null;
  const m = line.match(/^\s*(?:#{1,3}\s*)?CARD\s*\d*\s*[:.\-–—]*\s*(.*)$/i);
  return m ? m[1].trim() : '';
}

function matchNumberedHeader(line) {
  const m = line.match(/^\s*\d+[.)]\s+(.*)$/);
  return m ? m[1].trim() : null;
}

// Splits a leading SECTION token (e.g. "CORE-2") off the rest of a header's
// title text. Only called for "## CARD N — ..." style headers, since the
// section concept doesn't apply to the older numbered-list fallback format.
function parseSectionAndLabel(rawTitle) {
  const m = rawTitle.match(SECTION_TOKEN_RE);
  if (!m) {
    return { section: '', sectionBase: 'UNLABELLED', sectionRecognized: false, label: rawTitle };
  }
  const base = m[1];
  const section = base + (m[2] || '');
  const label = (m[3] || '').trim() || section;
  return { section, sectionBase: base, sectionRecognized: KNOWN_SECTIONS.includes(base), label };
}

function splitIntoBlocks(text) {
  const lines = text.split(/\r?\n/);
  const hasStrongHeaders = lines.some((l) => STRONG_HEADER_RE.test(l));

  const blocks = [];
  let current = null;

  for (const line of lines) {
    let rawTitle = null;
    let isStrong = false;
    if (hasStrongHeaders) {
      rawTitle = matchStrongHeader(line);
      isStrong = rawTitle !== null;
    } else {
      rawTitle = matchStrongHeader(line);
      isStrong = rawTitle !== null;
      if (rawTitle === null) rawTitle = matchNumberedHeader(line);
    }

    if (rawTitle !== null) {
      if (current) blocks.push(current);
      const sectionInfo = isStrong
        ? parseSectionAndLabel(rawTitle)
        : { section: '', sectionBase: 'UNLABELLED', sectionRecognized: undefined, label: rawTitle };
      current = { title: sectionInfo.label, ...sectionInfo, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
    // Lines before the first recognized header are dropped (preamble/metadata).
  }
  if (current) blocks.push(current);
  return blocks;
}

function parseBlock(block, index) {
  const locked = [];
  const free = [];
  const ideas = [];
  const locationNotes = [];
  const toneNotes = [];
  const brollNotes = [];
  let estimatedRuntime = '';
  let anchors = [];
  let title = block.title;

  let pendingType = null; // 'locked' | 'free' | null
  let buffer = [];

  const flush = () => {
    if (pendingType && buffer.length) {
      const text = buffer.join(' ').trim();
      if (text) (pendingType === 'locked' ? locked : free).push(text);
    }
    pendingType = null;
    buffer = [];
  };

  for (const rawLine of block.lines) {
    const line = rawLine.trim();

    if (!line) {
      flush();
      continue;
    }
    if (OTHER_NOTE_RE.test(line) || SEPARATOR_RE.test(line)) {
      flush();
      continue;
    }

    const locationMatch = line.match(LOCATION_RE);
    if (locationMatch) {
      flush();
      const { text, runtime } = extractRuntime(locationMatch[1].trim());
      if (text) locationNotes.push(text);
      if (runtime) estimatedRuntime = runtime;
      continue;
    }
    const toneMatch = line.match(TONE_RE);
    if (toneMatch) {
      flush();
      const val = toneMatch[1].trim();
      if (val) toneNotes.push(val);
      continue;
    }
    const brollMatch = line.match(BROLL_RE);
    if (brollMatch) {
      flush();
      const val = brollMatch[1].trim();
      if (val) brollNotes.push(val);
      continue;
    }

    const ideaMatch = line.match(IDEA_RE);
    if (ideaMatch) {
      flush();
      const val = ideaMatch[1].trim();
      if (val) ideas.push(val);
      continue;
    }
    const anchorsMatch = line.match(ANCHORS_RE);
    if (anchorsMatch) {
      flush();
      anchors = anchors.concat(
        anchorsMatch[1]
          .split(/[,/]/)
          .map((a) => a.trim())
          .filter(Boolean)
      );
      continue;
    }

    const lockedMatch = line.match(LOCKED_RE);
    if (lockedMatch) {
      flush();
      const inline = lockedMatch[1].trim();
      if (isLabelOnly(inline)) {
        pendingType = 'locked';
      } else if (inline) {
        locked.push(inline);
      } else {
        pendingType = 'locked';
      }
      continue;
    }
    const freeMatch = line.match(FREE_RE);
    if (freeMatch) {
      flush();
      const inline = freeMatch[1].trim();
      if (isLabelOnly(inline)) {
        pendingType = 'free';
      } else if (inline) {
        free.push(inline);
      } else {
        pendingType = 'free';
      }
      continue;
    }

    // Unrecognized line: continuation of a pending segment, the card title, or a stray note.
    if (pendingType) {
      buffer.push(line);
    } else if (!title) {
      title = line;
    } else {
      free.push(line);
    }
  }
  flush();

  if (!title) title = `Card ${index + 1}`;

  return {
    title,
    section: block.section || '',
    sectionBase: block.sectionBase || 'UNLABELLED',
    sectionRecognized: block.sectionRecognized,
    ideaText: ideas.join('\n\n'),
    anchors,
    lockedSegments: locked,
    freeSegments: free,
    locationNotes,
    toneNotes,
    brollNotes,
    estimatedRuntime,
  };
}

// A short line ending in ":" (e.g. "HOOK:", "FIGURE 1:", "SIGNATURE:") is a label
// for content on following lines, not the spoken content itself.
function isLabelOnly(text) {
  if (!text) return false;
  return text.endsWith(':') && text.length <= 40;
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
        section: '',
        sectionBase: 'UNLABELLED',
        sectionRecognized: undefined,
        ideaText: '',
        anchors: [],
        lockedSegments: [],
        freeSegments: rawText ? [rawText.trim()] : [],
        locationNotes: [],
        toneNotes: [],
        brollNotes: [],
        estimatedRuntime: '',
      },
    ];
  }

  return parsed.map((c, i) => ({
    id: `card-${i}-${Math.random().toString(36).slice(2, 7)}`,
    order: i,
    title: c.title,
    section: c.section || '',
    sectionBase: c.sectionBase || 'UNLABELLED',
    sectionRecognized: c.sectionRecognized,
    ideaText: c.ideaText,
    anchors: c.anchors,
    lockedSegments: c.lockedSegments,
    freeSegments: c.freeSegments,
    locationNotes: c.locationNotes || [],
    toneNotes: c.toneNotes || [],
    brollNotes: c.brollNotes || [],
    estimatedRuntime: c.estimatedRuntime || '',
    takes: [],
  }));
}
