import { inflateRawSync } from "node:zlib";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { REVIEW_DOC_LIMITS } from "./model";
import { ReviewExtractionError } from "./upload-validation";
import type { ExtractedBlocks } from "./extract";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WORD14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const MAX_XML_BYTES = 8 * 1024 * 1024;
const fail = (code: string, message: string): never => { throw new ReviewExtractionError(code, message); };
const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

/** Read only bounded OOXML parts, without writing ZIP paths or loading relationships. */
function docxParts(buffer: Buffer) {
  let end = -1;
  for (let pos = buffer.length - 22; pos >= Math.max(0, buffer.length - 65_557); pos--) {
    if (buffer.readUInt32LE(pos) === 0x06054b50 && pos + 22 + buffer.readUInt16LE(pos + 20) === buffer.length) { end = pos; break; }
  }
  if (end < 0) return fail("CORRUPT", "DOCX 압축 구조가 손상되었습니다.");
  const count = buffer.readUInt16LE(end + 10);
  const directoryLength = buffer.readUInt32LE(end + 12);
  let position = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count || count > 3000 || position + directoryLength !== end) return fail("ARCHIVE_LIMIT", "분할 압축 또는 허용 범위를 벗어난 DOCX입니다.");
  const parts = new Map<string, () => Buffer>();
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || buffer.readUInt32LE(position) !== 0x02014b50) return fail("CORRUPT", "DOCX 압축 구조가 손상되었습니다.");
    const flags = buffer.readUInt16LE(position + 8), method = buffer.readUInt16LE(position + 10);
    const checksum = buffer.readUInt32LE(position + 16), compressed = buffer.readUInt32LE(position + 20), size = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28), extraLength = buffer.readUInt16LE(position + 30), commentLength = buffer.readUInt16LE(position + 32);
    const offset = buffer.readUInt32LE(position + 42), next = position + 46 + nameLength + extraLength + commentLength;
    if (next > end) return fail("CORRUPT", "DOCX 압축 구조가 손상되었습니다.");
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    if (flags & 1) return fail("ENCRYPTED", "암호화된 문서는 지원하지 않습니다.");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || parts.has(name)) return fail("ARCHIVE_PATH", "안전하지 않은 압축 경로가 포함되어 있습니다.");
    if (/vbaProject|embeddings\/|activeX\//i.test(name)) return fail("ACTIVE_CONTENT", "매크로·OLE 개체가 포함된 문서는 제거 후 업로드해주세요.");
    expanded += size;
    if (expanded > 80 * 1024 * 1024 || (size > 1024 * 1024 && size > Math.max(compressed, 1) * 200)) return fail("ARCHIVE_LIMIT", "압축 해제 크기 또는 압축률 제한을 초과했습니다.");
    if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return fail("CORRUPT", "DOCX 압축 구조가 손상되었습니다.");
    const localNameLength = buffer.readUInt16LE(offset + 26);
    const start = offset + 30 + localNameLength + buffer.readUInt16LE(offset + 28);
    if (start + compressed > buffer.readUInt32LE(end + 16) || buffer.subarray(offset + 30, offset + 30 + localNameLength).toString("utf8") !== name) return fail("CORRUPT", "DOCX 압축 경로 또는 크기가 일치하지 않습니다.");
    parts.set(name, () => {
      if (size > MAX_XML_BYTES) return fail("ARCHIVE_LIMIT", "문서 XML이 8MB를 초과했습니다. 문서를 나누어 업로드해주세요.");
      let output: Buffer;
      try {
        const raw = buffer.subarray(start, start + compressed);
        output = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(1, size) }) : fail("CORRUPT", "지원하지 않는 DOCX 압축 방식입니다.");
      } catch { return fail("CORRUPT", "DOCX 압축 내용을 안전하게 읽지 못했습니다."); }
      if (output.length !== size || crc32(output) !== checksum) return fail("CORRUPT", "DOCX 내용의 무결성 확인에 실패했습니다.");
      return output;
    });
    position = next;
  }
  if (position !== end || !parts.has("word/document.xml")) return fail("FORMAT_MISMATCH", "실제 DOCX 문서가 아닙니다.");
  return parts;
}

function children(element: Element, name?: string) {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1 && (!name || (node.namespaceURI === WORD && node.localName === name)));
}
function descendants(element: Element) { return Array.from(element.getElementsByTagName("*")); }
function paragraphText(paragraph: Element) {
  const pieces: string[] = [];
  for (const element of descendants(paragraph)) {
    if (element.namespaceURI === WORD) {
      if (element.localName === "t") pieces.push(element.textContent ?? "");
      else if (element.localName === "tab") pieces.push("\t");
      else if (["br", "cr"].includes(element.localName!)) pieces.push("\n");
      else if (element.localName === "checkBox") {
        const checked = children(element, "checked")[0] ?? children(element, "default")[0];
        pieces.push(checked && ["1", "true"].includes(checked.getAttributeNS(WORD, "val") || "1") ? "☑" : "□");
      }
    } else if (element.namespaceURI === WORD14 && element.localName === "checked") pieces.push(["1", "true"].includes(element.getAttributeNS(WORD14, "val") || "1") ? "☑" : "□");
  }
  return pieces.join("").trim();
}

/** The same paragraph/table evidence as the dedicated converter, using Node only. */
export function extractDocxBlocks(buffer: Buffer): ExtractedBlocks {
  const parts = docxParts(buffer), warnings = new Set<string>();
  const blocks: ExtractedBlocks["blocks"] = [];
  let textLength = 0;
  const append = (block: ExtractedBlocks["blocks"][number]) => {
    textLength += block.text.length;
    if (textLength > REVIEW_DOC_LIMITS.sourceCharacters || blocks.length >= 30_000) fail("TEXT_LIMIT", "본문 또는 문단 수 제한을 초과했습니다. 문서를 나누어 업로드해주세요.");
    blocks.push(block);
  };
  const parse = (name: string) => {
    const xml = parts.get(name)!().toString("utf8");
    if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) return fail("XML_UNSAFE", "외부 엔티티 또는 DTD가 포함된 XML은 처리할 수 없습니다.");
    if ((xml.match(/</g) ?? []).length > 150_000) return fail("ARCHIVE_LIMIT", "문서 구조가 너무 복잡합니다. 문서를 나누어 업로드해주세요.");
    try {
      return new DOMParser({ onError: () => { throw new Error("invalid XML"); } }).parseFromString(xml, "text/xml");
    } catch { return fail("CORRUPT", "DOCX XML 구조가 손상되었습니다."); }
  };
  function visit(parent: Element, location: string, depth = 0) {
    if (depth > 100) fail("ARCHIVE_LIMIT", "문서 구조가 너무 깊습니다. 문서를 단순화해주세요.");
    children(parent).forEach((child, index) => {
      const loc = `${location}/${index + 1}`;
      if (child.namespaceURI !== WORD) return;
      if (child.localName === "p") {
        const text = paragraphText(child);
        if (text) append({ text, location: loc, kind: "paragraph" });
      } else if (child.localName === "tbl") {
        children(child, "tr").forEach((row, rowIndex) => {
          const cells = children(row, "tc").map((cell, cellIndex) => {
            const properties = children(cell, "tcPr")[0];
            const span = properties && children(properties, "gridSpan")[0];
            const merge = properties && children(properties, "vMerge")[0];
            return { text: Array.from(cell.getElementsByTagNameNS(WORD, "p")).map(paragraphText).join("\n").trim(), column: cellIndex + 1,
              colSpan: Number(span?.getAttributeNS(WORD, "val") || "1"), verticalMerge: merge ? merge.getAttributeNS(WORD, "val") || "continue" : null };
          });
          if (cells.some((cell) => cell.text)) append({ text: cells.map((cell) => cell.text).join("\t"), location: `${loc}/row:${rowIndex + 1}`, kind: "tableRow", cells });
        });
      } else if (["sdt", "sdtContent", "customXml", "footnote", "endnote"].includes(child.localName!)) visit(child, loc, depth + 1);
    });
  }
  const document = parse("word/document.xml");
  const body = document.getElementsByTagNameNS(WORD, "body")[0];
  if (!body) return fail("FORMAT_MISMATCH", "DOCX 본문이 없습니다.");
  visit(body, "본문");
  for (const name of parts.keys()) {
    if (/word\/(?:header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name)) visit(parse(name).documentElement!, name);
    if (name.endsWith(".rels") && Array.from(parse(name).getElementsByTagNameNS("*", "Relationship")).some((entry) => entry.getAttribute("TargetMode") === "External")) warnings.add("외부 링크는 읽거나 불러오지 않았습니다.");
  }
  if (!textLength) return fail("EMPTY_DOCUMENT", "전체 본문에서 텍스트를 추출하지 못했습니다.");
  return { format: "docx", blocks, warnings: [...warnings] };
}
