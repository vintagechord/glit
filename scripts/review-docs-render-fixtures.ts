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
  // Separate stress cases make overflow visible without multiplying every
  // per-track output: a credit taller than one page, and eight tall album rows.
  const longCredit = normalizedReviewFixture();
  longCredit.albums[0].tracks[0].composer = Array.from({ length: 55 }, (_, i) => `${i + 1}번째 작곡 참여자`).join("\n");
  const longCreditResult = await generateReviewDocuments(longCredit);
  for (const [index, file] of longCreditResult.files.filter((file) => /가요심의요청서_|심의폼_|앨범정보_/.test(file.name)).entries()) {
    const filename = `long-credit-${index + 1}.docx`;
    await writeFile(path.join(output, filename), file.buffer);
    manifest.push({ filename, archiveName: file.name, mode: "long-credit" });
  }
  const manyAlbums = normalizedReviewFixture();
  manyAlbums.albums = Array.from({ length: 8 }, (_, i) => {
    const item = structuredClone(album.albums[0]);
    item.id = `pagination-album-${i + 1}`;
    item.title = `${i + 1}번째 앨범과 조금 긴 제목`;
    item.artistName = Array.from({ length: 12 }, (_, artist) => `${artist + 1}번째 참여 가수`).join("\n");
    item.tracks = structuredClone(mv.albums[0].tracks);
    item.tracks.forEach((track) => { track.id = `${item.id}-${track.id}`; });
    return item;
  });
  const manyAlbumsResult = await generateReviewDocuments(manyAlbums);
  for (const [index, file] of manyAlbumsResult.files.filter((file) => file.name.startsWith("통합신청서/")).entries()) {
    const filename = `many-albums-${index + 1}.docx`;
    await writeFile(path.join(output, filename), file.buffer);
    manifest.push({ filename, archiveName: file.name, mode: "many-albums" });
  }
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`${manifest.length} synthetic DOCX fixtures: ${output}`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
