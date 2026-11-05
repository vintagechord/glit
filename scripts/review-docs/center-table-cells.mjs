// Sets every table cell of the review document templates to vertical-center,
// except cells that hold lyrics (long text reads from the top). Owner request
// 2026-11-06: values sat at the top of their cells. Run after replacing a
// template; it is idempotent.
//   node scripts/review-docs/center-table-cells.mjs templates/review-docs/*.docx tools/onside-desk/templates/*.docx
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../package.json', import.meta.url));
const PizZip = require('pizzip');

const LYRIC_TAG = /\{(?:lyrics|lyrics_with_translation|lyrics_display|translated_lyrics)\}/;
// CT_TcPr children that must come after vAlign.
const AFTER_VALIGN = /<w:(?:hideMark|headers|cellIns|cellDel|cellMerge|tcPrChange)\b/;

export function centerTableCells(xml) {
  let changed = 0;
  const output = xml.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g, (cell) => {
    if (LYRIC_TAG.test(cell.replace(/<[^>]+>/g, ''))) return cell;
    const open = cell.match(/^<w:tc(?:\s[^>]*)?>/)[0];
    const rest = cell.slice(open.length);
    const tcPr = rest.match(/^\s*<w:tcPr>([\s\S]*?)<\/w:tcPr>/);
    if (!tcPr) { changed++; return `${open}<w:tcPr><w:vAlign w:val="center"/></w:tcPr>${rest}`; }
    let body = tcPr[1];
    if (/<w:vAlign\b[^>]*\/>/.test(body)) {
      if (/<w:vAlign w:val="center"\/>/.test(body)) return cell;
      body = body.replace(/<w:vAlign\b[^>]*\/>/, '<w:vAlign w:val="center"/>');
    } else {
      const after = body.search(AFTER_VALIGN);
      body = after >= 0 ? `${body.slice(0, after)}<w:vAlign w:val="center"/>${body.slice(after)}` : `${body}<w:vAlign w:val="center"/>`;
    }
    changed++;
    return `${open}${rest.replace(tcPr[0], tcPr[0].replace(tcPr[1], body))}`;
  });
  return { xml: output, changed };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  for (const file of process.argv.slice(2)) {
    const zip = new PizZip(fs.readFileSync(file));
    const part = zip.file('word/document.xml');
    if (!part) continue;
    const { xml, changed } = centerTableCells(part.asText());
    if (!changed) { console.log(`${file}: unchanged`); continue; }
    zip.file('word/document.xml', xml);
    fs.writeFileSync(file, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
    console.log(`${file}: ${changed} cells centered`);
  }
}
