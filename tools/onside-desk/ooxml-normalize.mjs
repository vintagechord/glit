// Makes the review document templates strictly valid WordprocessingML, so the
// generated files open the same way in Microsoft Word on Windows, 한글, and
// the lenient readers (LibreOffice, Pages, Polaris) they were checked with.
// Owner report 2026-11-19: files that would not open on Windows, and tables
// drawn without lines.
//
// What it corrects (all found by validating against the ISO/IEC 29500 XSD):
//   * children of w:pPr, w:rPr, w:tblPr, w:tcPr, w:sectPr and the border and
//     margin groups are put in the order the schema requires. Word ignores or
//     rejects out-of-order properties: a w:tblBorders written after
//     w:tblLayout is exactly a table without lines;
//   * left/right borders, margins, indents and alignment are written as
//     left/right, never start/end (only newer readers know the latter);
//   * every cell of a table carries its own borders as well as the table
//     (readers differ in which of the two they honor);
//   * shading without its required pattern gets w:val="clear";
//   * mc:Ignorable naming a prefix that is not declared is removed. Word
//     refuses such a document;
//   * the theme's style lists are completed (three entries each are required);
//   * the package is written without ZIP folder entries.
//
// Idempotent. The templates are stored normalized
// (scripts/review-docs/normalize-ooxml.mjs), and every DOCX the web and the
// desk produce passes through normalizeDocxPackage once more before it is
// written, so a later template edit cannot bring the problems back.
import PizZip from 'pizzip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const SIDES = ['top', 'left', 'bottom', 'right'];

/** Child order required by the schema (ISO/IEC 29500-4 wml.xsd). */
export const OOXML_CHILD_ORDER = {
  pPr: ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs',
    'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid',
    'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl',
    'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'],
  rPr: ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof',
    'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText',
    'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange'],
  tblPr: ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd',
    'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription', 'tblPrChange'],
  tcPr: ['cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark',
    'headers', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange'],
  sectPr: ['headerReference', 'footerReference', 'footnotePr', 'endnotePr', 'type', 'pgSz', 'pgMar', 'paperSrc', 'pgBorders', 'lnNumType', 'pgNumType',
    'cols', 'formProt', 'vAlign', 'noEndnote', 'titlePg', 'textDirection', 'bidi', 'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange'],
  tblBorders: ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'],
  tcBorders: ['top', 'left', 'bottom', 'right', 'insideH', 'insideV', 'tl2br', 'tr2bl'],
  tblCellMar: SIDES,
  tcMar: SIDES,
  pBdr: ['top', 'left', 'bottom', 'right', 'between', 'bar'],
};
OOXML_CHILD_ORDER.tblPrEx = OOXML_CHILD_ORDER.tblPr;
/** Groups whose left/right members may have been written as start/end. */
const SIDED_GROUPS = new Set(['tblBorders', 'tcBorders', 'tblCellMar', 'tcMar']);

const elements = (node) => Array.from(node.childNodes).filter((child) => child.nodeType === 1);
const isW = (node, name) => node.nodeType === 1 && node.namespaceURI === W && node.localName === name;
const child = (node, name) => elements(node).find((item) => isW(item, name));
const all = (root, name) => Array.from(root.getElementsByTagNameNS(W, name));

function make(doc, name, attributes = {}) {
  const node = doc.createElementNS(W, `w:${name}`);
  for (const [key, value] of Object.entries(attributes)) node.setAttributeNS(W, `w:${key}`, value);
  return node;
}
function rename(doc, node, name) {
  const next = doc.createElementNS(W, `w:${name}`);
  for (const attribute of Array.from(node.attributes)) next.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  while (node.firstChild) next.appendChild(node.firstChild);
  node.parentNode.replaceChild(next, node);
  return next;
}
/** Stable sort of the element children; names the schema does not list keep their place at the end. */
function reorder(node, order) {
  const kids = elements(node);
  const rank = (item) => { const index = item.namespaceURI === W ? order.indexOf(item.localName) : -1; return index < 0 ? order.length : index; };
  const sorted = kids.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map(({ item }) => item);
  if (sorted.every((item, index) => item === kids[index])) return false;
  for (const item of sorted) node.appendChild(item);
  return true;
}
const borderAttributes = (source) => ({
  val: source?.getAttributeNS(W, 'val') || 'single', sz: source?.getAttributeNS(W, 'sz') || '4',
  space: source?.getAttributeNS(W, 'space') || '0', color: source?.getAttributeNS(W, 'color') || '000000',
});
const isLine = (node) => Boolean(node) && !['nil', 'none'].includes(node.getAttributeNS(W, 'val'));

/** Normalizes one WordprocessingML part. Returns the new XML and what changed. */
export function normalizeWordXml(xml, { borders = false } = {}) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  const changes = [];
  const note = (label) => { if (!changes.includes(label)) changes.push(label); };

  // 1. mc:Ignorable must only name declared prefixes.
  const ignorable = Array.from(root.attributes).find((attribute) => attribute.namespaceURI === MC && attribute.localName === 'Ignorable');
  if (ignorable) {
    const declared = new Set(Array.from(root.attributes).filter((attribute) => attribute.name.startsWith('xmlns:')).map((attribute) => attribute.name.slice(6)));
    const kept = ignorable.value.split(/\s+/).filter((prefix) => prefix && declared.has(prefix));
    if (kept.join(' ') !== ignorable.value.trim()) {
      if (kept.length) root.setAttributeNS(MC, ignorable.name, kept.join(' '));
      else {
        root.removeAttributeNode(ignorable);
        const prefix = ignorable.name.split(':')[0];
        if (!xml.includes(`<${prefix}:`)) root.removeAttribute(`xmlns:${prefix}`);
      }
      note('mc:Ignorable');
    }
  }

  // 2. left/right instead of start/end.
  for (const group of SIDED_GROUPS) for (const node of all(root, group)) for (const item of elements(node)) {
    if (isW(item, 'start')) { rename(doc, item, 'left'); note('start/end'); }
    if (isW(item, 'end')) { rename(doc, item, 'right'); note('start/end'); }
  }
  for (const node of all(root, 'ind')) for (const [from, to] of [['start', 'left'], ['end', 'right'], ['startChars', 'leftChars'], ['endChars', 'rightChars']]) {
    if (!node.hasAttributeNS(W, from)) continue;
    if (!node.hasAttributeNS(W, to)) node.setAttributeNS(W, `w:${to}`, node.getAttributeNS(W, from));
    node.removeAttributeNS(W, from);
    note('start/end');
  }
  for (const node of all(root, 'jc')) {
    const value = node.getAttributeNS(W, 'val');
    if (value === 'start' || value === 'end') { node.setAttributeNS(W, 'w:val', value === 'start' ? 'left' : 'right'); note('start/end'); }
  }

  // Shading needs its pattern stated; "clear" is a plain fill.
  for (const node of all(root, 'shd')) {
    if (node.hasAttributeNS(W, 'val')) continue;
    node.setAttributeNS(W, 'w:val', 'clear');
    if (!node.hasAttributeNS(W, 'color')) node.setAttributeNS(W, 'w:color', 'auto');
    note('shading pattern');
  }

  // 3. Every table and every cell draws its own lines.
  if (borders) for (const table of all(root, 'tbl')) {
    let tblPr = child(table, 'tblPr');
    if (!tblPr) { tblPr = make(doc, 'tblPr'); table.insertBefore(tblPr, table.firstChild); }
    const cells = elements(table).filter((row) => isW(row, 'tr')).flatMap((row) => elements(row).filter((cell) => isW(cell, 'tc')));
    let tblBorders = child(tblPr, 'tblBorders');
    const sample = (tblBorders && elements(tblBorders).find(isLine))
      || cells.map((cell) => child(cell, 'tcPr')).map((tcPr) => tcPr && child(tcPr, 'tcBorders')).flatMap((group) => (group ? elements(group) : [])).find(isLine);
    const line = borderAttributes(sample);
    if (!tblBorders) { tblBorders = make(doc, 'tblBorders'); tblPr.appendChild(tblBorders); note('table borders'); }
    for (const side of OOXML_CHILD_ORDER.tblBorders) {
      if (!child(tblBorders, side)) { tblBorders.appendChild(make(doc, side, line)); note('table borders'); }
    }
    for (const cell of cells) {
      let tcPr = child(cell, 'tcPr');
      if (!tcPr) { tcPr = make(doc, 'tcPr'); cell.insertBefore(tcPr, cell.firstChild); }
      let tcBorders = child(tcPr, 'tcBorders');
      if (!tcBorders) { tcBorders = make(doc, 'tcBorders'); tcPr.appendChild(tcBorders); }
      for (const side of SIDES) {
        if (!child(tcBorders, side)) { tcBorders.appendChild(make(doc, side, borderAttributes(child(tblBorders, side)))); note('cell borders'); }
      }
    }
  }

  // 4. Schema order, and no repeated property inside one run.
  for (const node of all(root, 'rPr')) {
    const seen = new Set();
    for (const item of elements(node)) {
      const key = new XMLSerializer().serializeToString(item);
      if (seen.has(key)) { node.removeChild(item); note('duplicate run property'); } else seen.add(key);
    }
  }
  for (const [name, order] of Object.entries(OOXML_CHILD_ORDER)) for (const node of all(root, name)) {
    if (reorder(node, order)) note(`order of w:${name}`);
  }

  const declaration = /^<\?xml[^>]*\?>/.exec(xml)?.[0] ?? '';
  const body = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
  return { xml: changes.length ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}` : xml, changes, declaration };
}

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
/** Repeats the last entry of a theme style list until it has the three the schema requires. */
export function completeThemeStyleLists(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  let changed = false;
  for (const listName of ['fillStyleLst', 'lnStyleLst', 'effectStyleLst', 'bgFillStyleLst']) {
    for (const list of Array.from(doc.getElementsByTagNameNS(A, listName))) {
      const items = elements(list);
      if (!items.length) continue;
      for (let count = items.length; count < 3; count += 1) { list.appendChild(items[items.length - 1].cloneNode(true)); changed = true; }
    }
  }
  return changed ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '')}` : xml;
}

/** Normalizes a whole .docx package. */
export function normalizeDocxPackage(buffer) {
  const source = new PizZip(buffer, { checkCRC32: true });
  const changes = [];
  const parts = new Map();
  let hadFolders = false;
  for (const [name, file] of Object.entries(source.files)) {
    if (file.dir) { hadFolders = true; continue; }
    parts.set(name, file.asNodeBuffer());
  }
  if (hadFolders) changes.push('ZIP folder entries');
  const text = (name) => parts.get(name)?.toString('utf8');

  for (const name of [...parts.keys()].filter((part) => /^word\/(?:document|styles|numbering|header\d*|footer\d*)\.xml$/.test(part))) {
    const result = normalizeWordXml(text(name), { borders: name === 'word/document.xml' });
    if (result.changes.length) { parts.set(name, Buffer.from(result.xml, 'utf8')); changes.push(...result.changes.map((change) => `${name}: ${change}`)); }
  }

  // A theme must list at least three fill, line, effect and background styles.
  for (const name of [...parts.keys()].filter((part) => /^word\/theme\/[^/]+\.xml$/.test(part))) {
    const repaired = completeThemeStyleLists(text(name));
    if (repaired !== text(name)) { parts.set(name, Buffer.from(repaired, 'utf8')); changes.push(`${name}: theme style lists completed`); }
  }

  if (!changes.length) return { buffer, changes };
  const output = new PizZip();
  // The content types come first, as Word writes them; a fixed date keeps the output reproducible.
  const order = ['[Content_Types].xml', '_rels/.rels'];
  const names = [...order.filter((name) => parts.has(name)), ...[...parts.keys()].filter((name) => !order.includes(name)).sort()];
  for (const name of names) output.file(name, parts.get(name), { createFolders: false, date: new Date(Date.UTC(2026, 0, 1)) });
  return { buffer: output.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), changes };
}
