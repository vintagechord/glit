import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import PizZip from "pizzip";
import { extractDocxBlocks } from "../src/lib/review-docs/docx-extract";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const fixture = () => readFile("tests/fixtures/review-docs/table-two-tracks.docx");

test("native DOCX retains footnotes and records external relationships without fetching them", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("a DOCX parser must never fetch relationships"); });
  const zip = new PizZip(await fixture());
  zip.file("word/footnotes.xml", `<w:footnotes xmlns:w="${WORD}"><w:footnote w:id="1"><w:p><w:r><w:t>보존해야 하는 각주 가사</w:t></w:r></w:p></w:footnote></w:footnotes>`);
  zip.file("word/_rels/document.xml.rels", '<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="external" TargetMode="External" Target="https://private.invalid/document" Type="hyperlink"/></r:Relationships>');
  const data = extractDocxBlocks(zip.generate({ type: "nodebuffer" }));
  assert.ok(data.blocks.some((block) => block.text === "보존해야 하는 각주 가사" && block.location.startsWith("word/footnotes.xml")));
  assert.ok(data.warnings.includes("외부 링크는 읽거나 불러오지 않았습니다."));
});

test("native DOCX rejects invalid CRC, oversized XML and corrupt XML without leaking source text", async () => {
  const original = await fixture();
  const invalidCrc = Buffer.from(original);
  const directory = invalidCrc.indexOf(Buffer.from("504b0102", "hex"));
  const position = invalidCrc.indexOf(Buffer.from("word/document.xml"), directory);
  const entry = invalidCrc.lastIndexOf(Buffer.from("504b0102", "hex"), position);
  invalidCrc.writeUInt32LE(0, entry + 16);
  assert.throws(() => extractDocxBlocks(invalidCrc), /무결성/);
  const tooLarge = new PizZip(original);
  tooLarge.file("word/document.xml", "x".repeat(8 * 1024 * 1024 + 1));
  assert.throws(() => extractDocxBlocks(tooLarge.generate({ type: "nodebuffer", compression: "STORE" })), /8MB/);
  const malformed = new PizZip(original);
  malformed.file("word/document.xml", `<w:document xmlns:w="${WORD}"><w:body><w:p>PRIVATE SOURCE</wrong></w:body></w:document>`);
  assert.throws(() => extractDocxBlocks(malformed.generate({ type: "nodebuffer" })), (error: unknown) => error instanceof Error && /XML 구조/.test(error.message) && !error.message.includes("PRIVATE"));
});
