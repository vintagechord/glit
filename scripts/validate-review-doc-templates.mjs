import { readFile } from "node:fs/promises";
import path from "node:path";

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

const templateDir = path.join(process.cwd(), "templates", "review-docs");
const templates = new Map([
  [
    "song-review-request.docx",
    ["{#tracks}", "{/tracks}", "{album_title}", "{production_company_for_review}"],
  ],
  [
    "review-form.docx",
    ["{#tracks}", "{/tracks}", "{album_title}", "{company_name}", "{lyrics_with_translation}"],
  ],
  [
    "lyrics-all.docx",
    ["{#tracks}", "{/tracks}", "{manager_name}", "{lyrics_with_translation}"],
  ],
  [
    "lyrics-track.docx",
    ["{manager_name}", "{track_title_with_title_mark}", "{lyrics_with_translation}"],
  ],
  [
    "tbs-integrated.docx",
    ["{#albums}", "{/albums}", "{company_actual}", "{release_date_md}"],
  ],
  [
    "wbs-integrated.docx",
    ["{#albums}", "{/albums}", "{company_actual}", "{review_songs_text}"],
  ],
  [
    "pbc-integrated.docx",
    ["{#albums}", "{/albums}", "{album_title}", "{company_actual}"],
  ],
]);

let invalid = false;
for (const [filename, requiredMarkers] of templates) {
  try {
    const buffer = await readFile(path.join(templateDir, filename));
    const zip = new PizZip(buffer);
    const document = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    const templateText = document.getFullText();
    const missingMarkers = requiredMarkers.filter(
      (marker) => !templateText.includes(marker),
    );
    if (missingMarkers.length > 0) {
      throw new Error(`missing markers: ${missingMarkers.join(", ")}`);
    }
    console.log(`OK ${filename}`);
  } catch (error) {
    invalid = true;
    console.error(
      `INVALID ${filename}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

if (invalid) process.exitCode = 1;
