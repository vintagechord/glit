import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { extractFiles, structureExtractedFile } from "../src/lib/review-docs/extract";

const execute = promisify(execFile);
const python = process.env.REVIEW_DOCS_PYTHON;
const pythonOnly = { skip: !python && "Requires the pinned worker converter and installed Korean font." };

test("rejected OCR layout stays in source evidence without becoming lyrics or duplicate tracks", () => {
  const result = structureExtractedFile({ id: "qa", name: "scan", kind: "file", text: "", warnings: [] }, { format: "pdf", warnings: [], blocks: [
    { text: "아티스트: 검증가수\n곡명: 검증노래\n가사: 함께 노래해", location: "OCR:단일열", kind: "ocr" },
    { text: "틀리게 읽힌 글자\n곡명: 중복노래\n가사: 중복가사", location: "OCR:자동배치원문", kind: "ocrAlternative" },
  ] }, "mv");
  assert.equal(result.albums[0].tracks.length, 1);
  assert.equal(result.albums[0].tracks[0].lyrics, "함께 노래해");
});

test("OCR retry only replaces a missing track label, preserves recognized fields and survives retry failure", pythonOnly, async () => {
  await execute(python!, ["-c", String.raw`
import importlib.util, subprocess, time
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('extract','services/review-docs/extract.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def lines(*values): return {('1','1',str(i)):[{'text':value}] for i,value in enumerate(values)}
original=lines('아티스트: 검증가수')
candidate=lines('아티스트: 검증가수','곡명: 검증노래','가사: 함께 노래해')
assert m.prefer_ocr_fallback(original,candidate)
assert not m.prefer_ocr_fallback(lines('곡명: 기존노래'),candidate)
assert not m.prefer_ocr_fallback(lines('아티스트: 다른가수'),candidate)
assert not m.prefer_ocr_fallback(original,lines('아티스트: 검증가수','곡명: 검증노래'))
for heading in ['title: Existing song','track title: Existing song','트랙: 기존곡','1. 기존곡','트랙 2) 기존곡','가수 - 기존곡']:
 assert m.has_ocr_track_heading(lines(heading))
 assert not m.prefer_ocr_fallback(lines('아티스트: 검증가수',heading),candidate)
tsv='block_num\tpar_num\tline_num\ttext\n1\t1\t1\t아티스트: 검증가수\n'
calls=[]
def run(args,**kwargs):
 calls.append((args,kwargs['timeout']))
 if len(calls)==1:return SimpleNamespace(stdout=tsv)
 raise subprocess.TimeoutExpired(args,kwargs['timeout'])
m.run_reader=run
selected,alternate=m.read_ocr('qa.png',time.monotonic()+10)
assert m.ocr_fields(selected)==m.ocr_fields(original) and alternate is None
assert len(calls)==2 and 0<calls[1][1]<=10
calls.clear()
selected,alternate=m.read_ocr('qa.png',time.monotonic()-1)
assert len(calls)==1 and alternate is None
calls.clear()
selected,alternate=m.read_ocr('qa.png',None)
assert len(calls)==1 and alternate is None
m.csv.field_size_limit(m.MAX_TEXT+2)
def oversized(args,**kwargs):
 if args[-2]=='3':return SimpleNamespace(stdout=tsv)
 return SimpleNamespace(stdout='block_num\tpar_num\tline_num\ttext\n1\t1\t1\t'+'x'*(m.MAX_TEXT+1)+'\n')
m.run_reader=oversized
selected,alternate=m.read_ocr('qa.png',time.monotonic()+10)
assert m.ocr_fields(selected)==m.ocr_fields(original) and alternate is None
`], { timeout: 30_000 });
});

test("a real Korean raster-only application recovers the song and preserves both OCR readings", pythonOnly, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "review-ocr-regression-"));
  try {
    const filename = path.join(temporary, "scanned-qa.pdf");
    await execute(python!, ["-c", `
import sys
from PIL import Image,ImageDraw,ImageFont
import pdfplumber
image=Image.new('RGB',(1800,2500),'white');draw=ImageDraw.Draw(image)
font=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',54)
lines=['앨범명: 검증음반','아티스트: 검증가수','기획사: 검증제작사','곡명: 검증노래','작사: 검증작사자','작곡: 검증작곡자','가사: 함께 노래해','오늘도 함께해']
for index,line in enumerate(lines):draw.text((150,150+index*115),line,font=font,fill='black')
image.save(sys.argv[1],'PDF',resolution=180.0)
image.save(sys.argv[1]+'.multiple.pdf','PDF',resolution=180.0,save_all=True,append_images=[image])
with pdfplumber.open(sys.argv[1]) as pdf:assert len(pdf.pages)==1 and not pdf.pages[0].chars
`, filename], { timeout: 30_000 });
    const data = await extractFiles([{ id: "qa", name: "scanned-qa.pdf", mime: "application/pdf", buffer: await readFile(filename) }], "album", "2026-09-11");
    assert.equal(data.albums.length, 1);
    assert.equal(data.albums[0].title.replace(/\s/g, ""), "검증음반");
    assert.equal(data.albums[0].tracks.length, 1);
    assert.equal(data.albums[0].tracks[0].title.replace(/\s/g, ""), "검증노래");
    assert.deepEqual(data.albums[0].tracks[0].lyrics.split("\n").map((line) => line.replace(/\s/g, "")), ["함께노래해", "오늘도함께해"]);
    assert.ok(data.sources[0].text.includes("OCR:자동배치원문:"));
    assert.ok(data.sources[0].text.includes("OCR:단일열:"));
    assert.ok(data.sources[0].warnings.some((warning) => warning.includes("표·다단 배치")));
    assert.ok(data.issues.some((issue) => issue.code === "EXTRACTION_REVIEW"));
    const multiple = await extractFiles([{ id: "multi", name: "multiple.pdf", mime: "application/pdf", buffer: await readFile(filename + ".multiple.pdf") }], "album", "2026-09-11");
    assert.equal(multiple.sources[0].pageCount, 2);
    assert.ok(!multiple.sources[0].text.includes("OCR:자동배치원문:"));
    assert.ok(!multiple.sources[0].text.includes("OCR:단일열:"));
    assert.ok(multiple.issues.some((issue) => issue.code === "EXTRACTION_REVIEW"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
