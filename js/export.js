function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeName(title) {
  return (title || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function exportSessionJSON(session) {
  const content = JSON.stringify(session, null, 2);
  download(`${safeName(session.title)}.json`, content, 'application/json');
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function exportSessionCSV(session) {
  const rows = [
    [
      'card_order',
      'card_title',
      'idea_text',
      'anchors',
      'locked_segments',
      'free_segments',
      'take_number',
      'take_timestamp_ms',
    ],
  ];

  for (const card of session.cards || []) {
    const base = [
      card.order,
      card.title,
      card.ideaText || '',
      (card.anchors || []).join('; '),
      (card.lockedSegments || []).join(' | '),
      (card.freeSegments || []).join(' | '),
    ];
    if (!card.takes || !card.takes.length) {
      rows.push([...base, '', '']);
    } else {
      for (const take of card.takes) {
        rows.push([...base, take.takeNumber, take.timestamp]);
      }
    }
  }

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  download(`${safeName(session.title)}.csv`, csv, 'text/csv');
}
