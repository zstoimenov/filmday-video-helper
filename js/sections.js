// Shared section vocabulary/colors used by the parser, filming view, and analytics.

export const KNOWN_SECTIONS = [
  'OPEN',
  'CTX',
  'TEASE',
  'RESET',
  'CORE',
  'PATR',
  'HEDGE',
  'CLOSE',
  'CTA',
];

const SECTION_COLORS = {
  OPEN: '#4fc3f7',
  CTX: '#81c784',
  TEASE: '#ba68c8',
  RESET: '#90a4ae',
  CORE: '#ffca28',
  PATR: '#f06292',
  HEDGE: '#e57373',
  CLOSE: '#7986cb',
  CTA: '#4db6ac',
};

const FALLBACK_COLOR = '#9a9a9a'; // matches --text-muted, used for UNLABELLED/unrecognised codes

export function getSectionColor(sectionBase) {
  return SECTION_COLORS[sectionBase] || FALLBACK_COLOR;
}
