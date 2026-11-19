import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { checkServerTraces, TEMPLATE_LOADER_MARKER } from "../scripts/check-server-traces.mjs";

// Until 2026-11-20 one template read through a folder held in a variable made
// the build ship the whole repository with 54 of 243 server routes, and
// nothing said so. The build now checks its own traces.

const templates = ["review-form.docx", "lyrics-all.docx"];
const shippedTemplates = templates.map((name) => `templates/review-docs/${name}`);
const built = [".next/server/chunks/a.js", "node_modules/pizzip/package.json", "../../outside/of/project.js"];
const generator = { route: "app/api/admin/review-docs/jobs/route.js", hasTemplateLoader: true, files: [...built, ...shippedTemplates] };

test("a build that ships only what the routes read passes", () => {
  assert.deepEqual(checkServerTraces([
    generator,
    { route: "app/page.js", hasTemplateLoader: false, files: [...built, "public/logo.png", "src/assets/fonts/nanum-gothic/NanumGothic-Bold.ttf", "package.json"] },
    { route: "app/api/x/route.js", hasTemplateLoader: false, files: ["services/review-docs/extract.py", "templates/review-docs/README.md"] },
  ], templates), []);
});

test("a route that drags the repository along is reported with examples", () => {
  const problems = checkServerTraces([
    generator,
    { route: "app/admin/page.js", hasTemplateLoader: false, files: [...built, "tests/a.test.ts", "docs/plan.md", "supabase/migrations/0001.sql", "src/lib/b2.ts", "tools/onside-desk/server.mjs"] },
  ], templates);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^app\/admin\/page\.js ships 5 project file\(s\) it should not, e\.g\. tests\/a\.test\.ts, docs\/plan\.md, supabase\/migrations\/0001\.sql$/);
});

test("a route that can generate documents must ship every template", () => {
  const problems = checkServerTraces([
    generator,
    { route: "app/api/admin/submissions/[id]/mv-lyrics/route.js", hasTemplateLoader: true, files: [...built, shippedTemplates[0]] },
    { route: "app/api/admin/submissions/review-docs/route.js", hasTemplateLoader: true, files: built },
  ], templates);
  assert.deepEqual(problems, [
    "app/api/admin/submissions/[id]/mv-lyrics/route.js can generate review documents but ships without lyrics-all.docx",
    "app/api/admin/submissions/review-docs/route.js can generate review documents but ships without review-form.docx, lyrics-all.docx",
  ]);
});

test("losing sight of the loader is a failure, not a pass", () => {
  const problems = checkServerTraces([{ route: "app/page.js", hasTemplateLoader: false, files: built }], templates);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /TEMPLATE_LOADER_MARKER/);
});

test("the marker is what the loader's source compiles to, and the build runs the check", () => {
  const source = readFileSync("src/lib/admin/review-docs.ts", "utf8");
  assert.match(source, /readFile\(path\.join\(process\.cwd\(\), "templates", "review-docs", filename\)\)/);
  assert.match('n.default.join(process.cwd(),"templates","review-docs",e)', TEMPLATE_LOADER_MARKER);
  assert.match(JSON.parse(readFileSync("package.json", "utf8")).scripts.build, /^next build && node scripts\/check-server-traces\.mjs$/);
});
