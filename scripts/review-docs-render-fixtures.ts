/** Writes synthetic local QA fixtures only. Never reads or uploads customer data. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateReviewDocuments } from "../src/lib/admin/review-docs";
import { normalizedReviewFixture, renderingReviewFixture } from "../tests/fixtures/review-docs/normalized";

async function main() {
  const output = path.resolve(process.argv[2] || "tmp/review-docs-qa/generated");
  const album = renderingReviewFixture();
  const mv = normalizedReviewFixture(); mv.mode = "mv";
  const manifest: Array<{ filename: string; archiveName: string; mode: string }> = [];
  for (const data of [album, mv]) {
    const result = await generateReviewDocuments(data);
    await mkdir(output, { recursive: true });
    for (const [index, file] of result.files.entries()) {
      const filename = `${data.mode}-${String(index + 1).padStart(2, "0")}.docx`;
      await writeFile(path.join(output, filename), file.buffer);
      manifest.push({ filename, archiveName: file.name, mode: data.mode });
    }
  }
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`${manifest.length} synthetic DOCX fixtures: ${output}`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
