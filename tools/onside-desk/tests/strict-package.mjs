import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import { OOXML_CHILD_ORDER } from '../ooxml-normalize.mjs';

/** The rules a strict reader (Word on Windows, 한글) holds a document to. */
export function assertStrictPackage(buffer, label) {
  const zip = new PizZip(buffer, { checkCRC32: true });
  assert.ok(Object.values(zip.files).every((file) => !file.dir), `${label}: no ZIP folder entries`);
  assert.equal(Object.keys(zip.files)[0], '[Content_Types].xml', `${label}: content types come first`);
  const xml = zip.file('word/document.xml').asText();
  // mc:Ignorable may only name declared prefixes.
  const root = xml.match(/<w:document[^>]*>/)[0];
  for (const prefix of (root.match(/Ignorable="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)) {
    assert.ok(root.includes(`xmlns:${prefix}=`), `${label}: Ignorable prefix ${prefix} is declared`);
  }
  // left/right, never start/end.
  assert.doesNotMatch(xml, /<w:(?:start|end)\b/, `${label}: borders and margins use left/right`);
  assert.doesNotMatch(xml, /w:(?:start|end)="/, `${label}: indents use left/right`);
  assert.doesNotMatch(xml, /<w:jc w:val="(?:start|end)"/, `${label}: alignment uses left/right`);
  // Schema order inside every property group.
  for (const [name, order] of Object.entries(OOXML_CHILD_ORDER)) {
    for (const [, body] of xml.matchAll(new RegExp(`<w:${name}>([\\s\\S]*?)</w:${name}>`, 'g'))) {
      // Direct children only: collapse nested groups before reading the names.
      let flat = body;
      for (const nested of Object.keys(OOXML_CHILD_ORDER)) {
        if (nested !== name) flat = flat.replace(new RegExp(`<w:${nested}>[\\s\\S]*?</w:${nested}>`, 'g'), `<w:${nested}/>`);
      }
      const ranks = [...flat.matchAll(/<w:(\w+)[\s/>]/g)].map(([, child]) => order.indexOf(child)).filter((rank) => rank >= 0);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${label}: children of w:${name} follow the schema order`);
    }
  }
  // Lines on every table and on every cell.
  for (const [table] of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)) {
    const tblPr = table.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/)[0];
    for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
      assert.match(tblPr, new RegExp(`<w:tblBorders>[\\s\\S]*<w:${side} w:val="single"`), `${label}: table ${side} line`);
    }
    for (const [cell] of table.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)) {
      const borders = cell.match(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/)?.[1] ?? '';
      for (const side of ['top', 'left', 'bottom', 'right']) assert.match(borders, new RegExp(`<w:${side} w:val="single"`), `${label}: cell ${side} line`);
    }
  }
  assert.doesNotMatch(xml, /<w:shd(?![^>]*w:val=)[^>]*>/, `${label}: shading states its pattern`);
  const theme = zip.file('word/theme/theme1.xml')?.asText();
  if (theme) {
    for (const list of ['fillStyleLst', 'lnStyleLst', 'effectStyleLst', 'bgFillStyleLst']) {
      const body = theme.match(new RegExp(`<a:${list}>([\\s\\S]*?)</a:${list}>`))[1];
      const first = body.match(/<a:(\w+)/)[1];
      assert.ok(body.split(`<a:${first}`).length - 1 >= 3, `${label}: theme ${list} has three entries`);
    }
  }
}
