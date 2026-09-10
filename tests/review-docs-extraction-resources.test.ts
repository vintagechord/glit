import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractFileBlocks, extractFiles } from "../src/lib/review-docs/extract";
import { converterMemoryExceeded, converterTimeoutSeconds, LOW_MEMORY_CONVERTER_RSS, LOW_MEMORY_WEB_RESERVE } from "../src/lib/review-docs/converter-memory";

const rtf = Buffer.from("{\\rtf1\\ansi test}");
const file = { id: "cancel-fixture", name: "cancel.doc", mime: "application/msword", buffer: rtf };
const waitUntil = async (predicate: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("fixture converter did not start");
};

test("only opt-in low-memory conversion receives the Free CPU time budget", () => {
  const previous = process.env.REVIEW_DOCS_LOW_MEMORY;
  try {
    delete process.env.REVIEW_DOCS_LOW_MEMORY;
    assert.equal(converterTimeoutSeconds(), 90);
    for (const value of ["false", "0", "disabled"]) {
      process.env.REVIEW_DOCS_LOW_MEMORY = value;
      assert.equal(converterTimeoutSeconds(), 90);
    }
    for (const value of ["true", "1", "TRUE"]) {
      process.env.REVIEW_DOCS_LOW_MEMORY = value;
      assert.equal(converterTimeoutSeconds(), 240);
    }
  } finally {
    if (previous === undefined) delete process.env.REVIEW_DOCS_LOW_MEMORY; else process.env.REVIEW_DOCS_LOW_MEMORY = previous;
  }
});

async function fixtureConverter(script: (marker: string) => string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "review-resource-test-"));
  const executable = path.join(directory, "reader");
  const marker = path.join(directory, "marker.json");
  await writeFile(executable, `#!/usr/bin/env node\n${script(marker)}`);
  await chmod(executable, 0o700);
  return { directory, executable, marker };
}

test("aborted extraction never launches a converter or reads a lazy source", async () => {
  const signal = AbortSignal.abort(new Error("cancelled before extraction"));
  await assert.rejects(extractFileBlocks(file, signal), /cancelled before extraction/);
  let reads = 0;
  await assert.rejects(extractFiles([{ id: "lazy", name: "lazy.doc", mime: file.mime, load: async () => { reads++; return rtf; } }], "album", "2026-09-11", signal), /cancelled before extraction/);
  assert.equal(reads, 0);
});

test("running converter is killed before cancellation settles and its private temporary file is removed", async () => {
  const fixture = await fixtureConverter(marker => `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,input:process.argv[3],low:process.env.REVIEW_DOCS_LOW_MEMORY,omp:process.env.OMP_THREAD_LIMIT,arena:process.env.MALLOC_ARENA_MAX}));setInterval(()=>{},1000);`);
  const previousPython = process.env.REVIEW_DOCS_PYTHON;
  const previousLow = process.env.REVIEW_DOCS_LOW_MEMORY;
  process.env.REVIEW_DOCS_PYTHON = fixture.executable;
  process.env.REVIEW_DOCS_LOW_MEMORY = "true";
  const controller = new AbortController();
  try {
    const rejection = assert.rejects(extractFileBlocks(file, controller.signal), /cancel extraction fixture/);
    await waitUntil(() => access(fixture.marker).then(() => true, () => false));
    const observed = JSON.parse(await readFile(fixture.marker, "utf8"));
    assert.deepEqual([observed.low, observed.omp, observed.arena], ["true", "1", "2"]);
    controller.abort(new Error("cancel extraction fixture"));
    await rejection;
    assert.throws(() => process.kill(observed.pid, 0), /ESRCH/);
    await assert.rejects(access(path.dirname(observed.input)), /ENOENT/);
  } finally {
    controller.abort();
    if (previousPython === undefined) delete process.env.REVIEW_DOCS_PYTHON; else process.env.REVIEW_DOCS_PYTHON = previousPython;
    if (previousLow === undefined) delete process.env.REVIEW_DOCS_LOW_MEMORY; else process.env.REVIEW_DOCS_LOW_MEMORY = previousLow;
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("cancelling a running lazy extraction never loads the next file or converts cancellation into a source failure", async () => {
  const fixture = await fixtureConverter(marker => `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000);`);
  const previousPython = process.env.REVIEW_DOCS_PYTHON;
  process.env.REVIEW_DOCS_PYTHON = fixture.executable;
  const controller = new AbortController();
  const reads: string[] = [];
  try {
    const rejection = assert.rejects(extractFiles(["first", "second"].map(id => ({ id, name: `${id}.doc`, mime: file.mime, load: async () => { reads.push(id); return rtf; } })), "album", "2026-09-11", controller.signal), /cancel sequence/);
    await waitUntil(() => access(fixture.marker).then(() => true, () => false));
    assert.deepEqual(reads, ["first"]);
    controller.abort(new Error("cancel sequence"));
    await rejection;
    assert.deepEqual(reads, ["first"]);
  } finally {
    controller.abort();
    if (previousPython === undefined) delete process.env.REVIEW_DOCS_PYTHON; else process.env.REVIEW_DOCS_PYTHON = previousPython;
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("lazy sources preserve exact album merging and duplicate-source detection", async () => {
  const names = ["table-two-tracks.docx", "conflicting-revision.docx", "table-two-tracks.docx"];
  const buffers = await Promise.all(names.map(name => readFile(`tests/fixtures/review-docs/${name}`)));
  const plain = await extractFiles(names.map((name, index) => ({ id: String(index), name, mime: "", buffer: buffers[index] })), "album", "2026-09-11");
  const reads: number[] = [];
  const lazy = await extractFiles(names.map((name, index) => ({ id: String(index), name, mime: "", size: buffers[index].length, load: async () => { reads.push(index); return buffers[index]; } })), "album", "2026-09-11");
  const meaning = (data: typeof lazy) => ({
    sources: data.sources.map(source => ({ id: source.id, sha256: source.sha256, text: source.text })),
    albums: data.albums.map(album => ({ title: album.title, artist: album.artistName, tracks: album.tracks.map(track => ({ number: track.number, title: track.title, lyrics: track.lyrics, composer: track.composer })) })),
    issues: data.issues.map(issue => issue.code).sort(),
  });
  assert.deepEqual(reads, [0, 1, 2]);
  assert.deepEqual(meaning(lazy), meaning(plain));
  assert.ok(lazy.issues.some(issue => issue.code === "DUPLICATE_SOURCE"));
  assert.ok(lazy.issues.some(issue => issue.code === "TRACK_REVISION_CONFLICT"));
});

test("converter memory guard preserves web headroom and rejects excessive subtree RSS", () => {
  const limit = 512 * 1024 * 1024;
  assert.equal(converterMemoryExceeded({ converterRss: LOW_MEMORY_CONVERTER_RSS, used: limit - LOW_MEMORY_WEB_RESERVE, limit }), false);
  assert.equal(converterMemoryExceeded({ converterRss: LOW_MEMORY_CONVERTER_RSS + 1 }), true);
  assert.equal(converterMemoryExceeded({ converterRss: 0, used: limit - LOW_MEMORY_WEB_RESERVE + 1, limit }), true);
});

test("Linux cancellation also terminates the Python reader child through PDEATHSIG", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "review-pdeath-test-"));
  const executable = path.join(directory, "reader");
  const marker = path.join(directory, "child.json");
  const childScript = `import json,os,time;open(${JSON.stringify(marker)},'w').write(json.dumps({'pid':os.getpid()}));time.sleep(60)`;
  const script = `#!/usr/bin/env python3
import importlib.util, json, os, sys
spec=importlib.util.spec_from_file_location('extract',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
child=${JSON.stringify(childScript)}
m.run_reader([sys.executable,'-c',child],capture_output=True,timeout=90)
`;
  await writeFile(executable, script); await chmod(executable, 0o700);
  const previousPython = process.env.REVIEW_DOCS_PYTHON;
  process.env.REVIEW_DOCS_PYTHON = executable;
  const controller = new AbortController();
  try {
    const rejection = assert.rejects(extractFileBlocks(file, controller.signal), /cancel child fixture/);
    await waitUntil(() => access(marker).then(() => true, () => false));
    const { pid } = JSON.parse(await readFile(marker, "utf8"));
    controller.abort(new Error("cancel child fixture"));
    await rejection;
    const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
    assert.ok(!status || /^State:\s+Z/m.test(status), "reader child must not remain running after the converter promise settles");
  } finally {
    controller.abort();
    if (previousPython === undefined) delete process.env.REVIEW_DOCS_PYTHON; else process.env.REVIEW_DOCS_PYTHON = previousPython;
    await rm(directory, { recursive: true, force: true });
  }
});

test("Linux low-memory mode stops only an excessive converter and returns a recoverable source limit", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureConverter(marker => `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,input:process.argv[3]}));globalThis.allocation=Buffer.alloc(230*1024*1024,1);setInterval(()=>{},1000);`);
  const previousPython = process.env.REVIEW_DOCS_PYTHON;
  const previousLow = process.env.REVIEW_DOCS_LOW_MEMORY;
  process.env.REVIEW_DOCS_PYTHON = fixture.executable;
  process.env.REVIEW_DOCS_LOW_MEMORY = "true";
  try {
    await assert.rejects(extractFileBlocks(file), (error: unknown) => error instanceof Error && "code" in error && error.code === "EXTRACTION_LIMIT");
    const { pid, input } = JSON.parse(await readFile(fixture.marker, "utf8"));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    await assert.rejects(access(path.dirname(input)), /ENOENT/);
  } finally {
    if (previousPython === undefined) delete process.env.REVIEW_DOCS_PYTHON; else process.env.REVIEW_DOCS_PYTHON = previousPython;
    if (previousLow === undefined) delete process.env.REVIEW_DOCS_LOW_MEMORY; else process.env.REVIEW_DOCS_LOW_MEMORY = previousLow;
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
