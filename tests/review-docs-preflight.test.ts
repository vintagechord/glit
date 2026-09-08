import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, copyFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  checkReviewDatabase, checkReviewTemplates, checkReviewWorker, ReviewWorkerPreflightError,
  safeReviewWorkerStartupError, startCheckedReviewWorker, validateConverterCheckOutput,
} from "../scripts/review-docs/preflight";

function checks(events: string[], fail?: string) {
  return Object.fromEntries(["converters", "templates", "database", "storage"].map((name) => [name, async () => {
    events.push(name);
    if (name === fail) throw new ReviewWorkerPreflightError("PREFLIGHT_FAILED");
  }])) as Parameters<typeof checkReviewWorker>[0];
}

test("read-only --check verifies every dependency without entering the claim/cleanup loop", async () => {
  const events: string[] = [];
  const report = await startCheckedReviewWorker(["--check"], {
    preflight: () => checkReviewWorker(checks(events), false),
    run: async () => { throw new Error("must never claim, publish heartbeat, or clean up"); },
  });
  assert.deepEqual(events, ["converters", "templates", "database", "storage"]);
  assert.equal(report.ok, true);
  assert.equal(report.translationConfigured, false);
  assert.deepEqual(report.warnings, ["TRANSLATION_UNAVAILABLE"]);
});

test("normal worker can claim only after all startup checks pass", async () => {
  const events: string[] = [];
  const report = await startCheckedReviewWorker([], {
    preflight: () => checkReviewWorker(checks(events), true),
    run: async () => { events.push("claim"); },
  });
  assert.deepEqual(events, ["converters", "templates", "database", "storage", "claim"]);
  assert.deepEqual(report.warnings, []);
});

test("each failed startup dependency prevents claims and later checks", async () => {
  const names = ["converters", "templates", "database", "storage"];
  for (const [index, name] of names.entries()) {
    const events: string[] = [];
    await assert.rejects(startCheckedReviewWorker([], {
      preflight: () => checkReviewWorker(checks(events, name), true),
      run: async () => { throw new Error("claimed despite failed preflight"); },
    }), ReviewWorkerPreflightError);
    assert.deepEqual(events, names.slice(0, index + 1));
  }
});

test("mistyped check flags cannot accidentally start production processing", async () => {
  for (const args of [["--chek"], ["--check", "extra"], ["--once"]]) {
    await assert.rejects(startCheckedReviewWorker(args, {
      preflight: async () => { throw new Error("must reject before preflight"); },
      run: async () => { throw new Error("must reject before processing"); },
    }), (error) => error instanceof ReviewWorkerPreflightError && error.code === "INVALID_ARGUMENTS");
  }
});

test("converter and startup errors expose fixed codes rather than subprocess output or secrets", () => {
  assert.doesNotThrow(() => validateConverterCheckOutput('{"ok":true}'));
  assert.throws(() => validateConverterCheckOutput('{"ok":false,"code":"OCR_LANGUAGES_UNAVAILABLE"}'),
    (error) => error instanceof ReviewWorkerPreflightError && error.code === "OCR_LANGUAGES_UNAVAILABLE");
  for (const raw of ["private-key=secret", '{"ok":false,"code":"secret"}', "null", '{"ok":"true"}']) {
    try { validateConverterCheckOutput(raw); assert.fail("malformed output accepted"); }
    catch (error) {
      const result = safeReviewWorkerStartupError(error);
      assert.equal(result.code, "CONVERTER_CHECK_FAILED");
      assert.ok(!JSON.stringify(result).includes("secret"));
    }
  }
  assert.equal(safeReviewWorkerStartupError(new Error("private-key=secret")).code, "PREFLIGHT_FAILED");
  assert.ok(!JSON.stringify(safeReviewWorkerStartupError(new Error("private-key=secret"))).includes("secret"));
});

test("real template check requires all eight DOCX containers and rejects a corrupt template", async () => {
  await checkReviewTemplates();
  const directory = await mkdtemp(path.join(os.tmpdir(), "onside-preflight-"));
  try {
    const source = path.resolve("templates/review-docs");
    const files = (await readdir(source)).filter((name) => name.endsWith(".docx"));
    assert.equal(files.length, 8);
    for (const file of files) await copyFile(path.join(source, file), path.join(directory, file));
    await checkReviewTemplates(directory);
    await writeFile(path.join(directory, files[0]), "corrupt");
    await assert.rejects(checkReviewTemplates(directory), (error) => error instanceof ReviewWorkerPreflightError && error.code === "TEMPLATES_UNAVAILABLE");
    await rm(path.join(directory, files[0]));
    await assert.rejects(checkReviewTemplates(directory), /템플릿/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function databaseEnvironment(t: TestContext) {
  const values = { SUPABASE_URL: "https://review-preflight-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service" };
  for (const [key, value] of Object.entries(values)) {
    const original = process.env[key]; process.env[key] = value;
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
}

test("database preflight uses zero-row GET reads only, without claiming or publishing readiness", async (t) => {
  databaseEnvironment(t);
  const tables: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, "review-preflight-test.supabase.co");
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(url.searchParams.get("limit"), "0");
    assert.ok(!url.pathname.includes("/rpc/"));
    tables.push(url.pathname.split("/").pop()!);
    return Response.json([]);
  });
  await checkReviewDatabase();
  assert.deepEqual(tables, ["review_document_jobs", "review_document_job_events", "review_document_artifacts", "review_document_worker_heartbeat"]);
});

test("database schema/permission errors and service failures remain actionable and private", async (t) => {
  databaseEnvironment(t);
  let responseCode = "PGRST205";
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: responseCode, message: "secret connection details" }, { status: 400 }));
  await assert.rejects(checkReviewDatabase(), (error) => error instanceof ReviewWorkerPreflightError && error.code === "MIGRATION_REQUIRED" && !error.message.includes("secret"));
  responseCode = "SOME_NETWORK_ERROR";
  await assert.rejects(checkReviewDatabase(), (error) => error instanceof ReviewWorkerPreflightError && error.code === "DATABASE_UNAVAILABLE" && !error.message.includes("secret"));
});

test("Python preflight detects missing readers and OCR languages without processing a document", () => {
  const script = [
    "import importlib.util, json, sys, types",
    "from unittest.mock import patch",
    "spec = importlib.util.spec_from_file_location('review_check', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
    "results = []",
    "def execute(case):",
    "    def import_module(name):",
    "        if case == 'python': raise ImportError('secret path')",
    "        return types.SimpleNamespace()",
    "    def which(name): return None if case == name else '/mock/' + name",
    "    def run(args, **kwargs):",
    "        return types.SimpleNamespace(returncode=0, stdout='eng\\nkor\\n' if case == 'languages' else 'eng\\nkor\\njpn\\n')",
    "    with patch.object(module.importlib, 'import_module', import_module), patch.object(module.shutil, 'which', which), patch.object(module.subprocess, 'run', run):",
    "        try: module.check_converters(); return 'ok'",
    "        except module.CheckError as error: return error.code",
    "for case in ('ok', 'python', 'antiword', 'pdftoppm', 'tesseract', 'languages'): results.append(execute(case))",
    "print(json.dumps(results))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, path.resolve("services/review-docs/check.py")], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["ok", "PYTHON_DEPENDENCIES_UNAVAILABLE", "DOC_CONVERTER_UNAVAILABLE", "PDF_CONVERTER_UNAVAILABLE", "OCR_CONVERTER_UNAVAILABLE", "OCR_LANGUAGES_UNAVAILABLE"]);
});
