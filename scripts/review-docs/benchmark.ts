import { performance } from "node:perf_hooks";
import { generateReviewDocuments } from "../../src/lib/admin/review-docs";
import { emptyReviewData, reviewAlbumSchema, reviewTrackSchema } from "../../src/lib/review-docs/model";

async function main() {
  const data = emptyReviewData("album", "2026-09-07");
  let number = 0;
  for (let i = 0; i < 8; i++) {
    const tracks = Array.from({ length: i < 4 ? 13 : 12 }, (_, j) => {
      number++;
      return reviewTrackSchema.parse({ id: `track-${number}`, number: j + 1, title: `검증 노래 ${number}`, lyrics: Array.from({ length: 90 }, (_, line) => `${line + 1}절 바람을 따라 걷는 우리의 노래를 기억해 같은 구절도 그대로 남겨둔다`).join("\n"), lyricStatus: "provided" });
    });
    data.albums.push(reviewAlbumSchema.parse({ id: `album-${i}`, title: `부하 검증 앨범 ${i}`, artistName: "검수 가수", company: "검수 제작사", tracks }));
  }
  const start = performance.now();
  const result = await generateReviewDocuments(data);
  console.log(JSON.stringify({ albums: result.albumCount, tracks: result.trackCount, docx: result.docxCount, seconds: +((performance.now() - start) / 1000).toFixed(2), zipBytes: result.zip.length, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), structureChecked: result.validation.structureChecked, rendered: false }));
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Benchmark failed"); process.exitCode = 1; });
