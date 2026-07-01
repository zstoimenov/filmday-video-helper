// Tolerant parser for the E2A scene-card script format.
//
// v3 format (current): every card is strictly wrapped in "---" delimiter
// lines ("--- [card] --- [card] --- ..."), with the very first and very
// last line of the whole pasted text being a "---". Each card is exactly
// ONE beat: a header line, then a fixed field order (📍 location, optional
// 📷 B-ROLL, 🎵 TONE, blank line), then exactly one 🔒 LOCKED: or
// 🔓 FREE: block (never both, never more than one). LOCKED/FREE labels are
// always the literal words "LOCKED"/"FREE" - no more custom sub-labels
// (no more 🔒 HOOK:, 🔒 SIGNATURE: etc). This format is detected by
// checking whether the first non-blank line of the whole paste is a "---"
// delimiter; if so, cards are split strictly on those delimiters.
//
// v1/v2 format (legacy, still supported for older pastes and for
// already-saved sessions): header-driven splitting, a card may contain
// multiple 🔒/🔓 blocks each with its own custom label ("🔒 HOOK:\nSay
// this exact line."), production notes appear in any order, and any
// "---" lines are purely decorative separators rather than structural
// delimiters.
//
// Headers in both formats carry a SECTION code right after the card
// number: "## CARD 8 — CORE-2 Минутите" -> section "CORE-2", sectionBase
// "CORE", label "Минутите". SECTION is a closed set (see sections.js) but
// an unrecognised code is still parsed normally and just flagged, per
// spec. A v3 card that violates the one-beat rule (multiple LOCKED/FREE
// blocks, or a missing header) is also parsed in full and just flagged
// via `formatWarning` rather than dropped or crashed on.

import { KNOWN_SECTIONS } from './sections.js';

const STRONG_HEADER_RE = /^\s*(?:#{1,3}\s*)?CARD\b/i;
const SECTION_TOKEN_RE = /^([A-Z]{2,10})(-\d+)?\s+(.*)$/;
const CARD_DELIM_RE = /^-{3,}\s*$/;
const LOCKED_RE = /^\s*🔒\s*(.*)$/;
const FREE_RE = /^\s*🔓\s*(.*)$/;
const LOCKED_LABEL_RE = /^\s*🔒\s*LOCKED\s*:\s*(.*)$/i;
const FREE_LABEL_RE = /^\s*🔓\s*FREE\s*:\s*(.*)$/i;
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

// ---------- v3: strict "---"-delimited, one-beat-per-card format ----------

// Cards are the text found strictly between consecutive "---" delimiter
// lines. The leading "---" (before card 1) and trailing "---" (after the
// last card) are boundaries only, contributing no chunk of their own.
function splitByCardDelimiter(lines) {
  const delimIndexes = [];
  lines.forEach((l, i) => {
    if (CARD_DELIM_RE.test(l.trim())) delimIndexes.push(i);
  });

  const chunks = [];
  for (let i = 0; i < delimIndexes.length - 1; i++) {
    const chunkLines = lines.slice(delimIndexes[i] + 1, delimIndexes[i + 1]);
    if (chunkLines.some((l) => l.trim())) chunks.push(chunkLines);
  }
  return chunks;
}

// Parses the fixed-order body of a single v3 card: 📍 location (+optional
// trailing runtime), optional 📷 B-ROLL, 🎵 TONE, blank line, then exactly
// one 🔒 LOCKED: / 🔓 FREE: block. Field order in the source doesn't
// actually need to be enforced here since every line is matched against
// its own marker regardless of position - `beatCount` tracks how many
// LOCKED/FREE blocks were found so the caller can flag one-beat violations.
function parseNewCardBody(bodyLines) {
  const locked = [];
  const free = [];
  const ideas = [];
  const locationNotes = [];
  const toneNotes = [];
  const brollNotes = [];
  let estimatedRuntime = '';
  let anchors = [];
  let beatCount = 0;

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

  for (const rawLine of bodyLines) {
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

    const lockedMatch = line.match(LOCKED_LABEL_RE);
    if (lockedMatch) {
      flush();
      beatCount += 1;
      const inline = lockedMatch[1].trim();
      pendingType = 'locked';
      buffer = inline ? [inline] : [];
      continue;
    }
    const freeMatch = line.match(FREE_LABEL_RE);
    if (freeMatch) {
      flush();
      beatCount += 1;
      const inline = freeMatch[1].trim();
      pendingType = 'free';
      buffer = inline ? [inline] : [];
      continue;
    }

    // Unrecognized line: continuation of the pending LOCKED/FREE block, or
    // a stray note otherwise - dropped rather than misfiled, since v3 has
    // no title-on-first-unmatched-line convention like the legacy format.
    if (pendingType) {
      buffer.push(line);
    }
  }
  flush();

  return {
    ideaText: ideas.join('\n\n'),
    anchors,
    lockedSegments: locked,
    freeSegments: free,
    locationNotes,
    toneNotes,
    brollNotes,
    estimatedRuntime,
    beatCount,
  };
}

function parseNewFormatCard(chunkLines, index) {
  let i = 0;
  while (i < chunkLines.length && !chunkLines[i].trim()) i++;
  const headerLine = chunkLines[i];
  const rawTitle = headerLine !== undefined ? matchStrongHeader(headerLine) : null;
  const hasHeader = rawTitle !== null;

  const sectionInfo = hasHeader
    ? parseSectionAndLabel(rawTitle)
    : { section: '', sectionBase: 'UNLABELLED', sectionRecognized: false, label: '' };
  const bodyLines = hasHeader ? chunkLines.slice(i + 1) : chunkLines.slice(i);
  const body = parseNewCardBody(bodyLines);

  const title = sectionInfo.label || `Card ${index + 1}`;

  return {
    title,
    section: sectionInfo.section,
    sectionBase: sectionInfo.sectionBase,
    sectionRecognized: sectionInfo.sectionRecognized,
    // One beat per card is a hard rule; a card with zero or more than one
    // LOCKED/FREE block (or no header at all) is still fully parsed and
    // used, just flagged as malformed rather than dropped or crashed on.
    formatWarning: !hasHeader || body.beatCount !== 1,
    ideaText: body.ideaText,
    anchors: body.anchors,
    lockedSegments: body.lockedSegments,
    freeSegments: body.freeSegments,
    locationNotes: body.locationNotes,
    toneNotes: body.toneNotes,
    brollNotes: body.brollNotes,
    estimatedRuntime: body.estimatedRuntime,
  };
}

// ---------- legacy: header-driven, multi-beat-per-card format ----------

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
    formatWarning: false,
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

function isCardNonEmpty(c) {
  return c.title || c.ideaText || c.anchors.length || c.lockedSegments.length || c.freeSegments.length;
}

export function parseScript(rawText) {
  const text = (rawText || '').trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const firstContentIdx = lines.findIndex((l) => l.trim());
  const usesNewFormat = firstContentIdx !== -1 && CARD_DELIM_RE.test(lines[firstContentIdx].trim());

  if (usesNewFormat) {
    const chunks = splitByCardDelimiter(lines);
    const cards = chunks.map((chunkLines, i) => parseNewFormatCard(chunkLines, i)).filter(isCardNonEmpty);
    if (cards.length) return cards;
    // Fall through to legacy parsing if the strict split produced nothing usable.
  }

  const blocks = splitIntoBlocks(text);
  const cards = blocks.filter((b) => b.title || b.lines.some((l) => l.trim())).map((b, i) => parseBlock(b, i));

  return cards.filter(isCardNonEmpty);
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
        formatWarning: false,
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
    formatWarning: !!c.formatWarning,
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
