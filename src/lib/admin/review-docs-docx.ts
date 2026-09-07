import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

type TemplatePrimitive = string | number | boolean | null | undefined;

export type ReviewDocTemplateValue =
  | TemplatePrimitive
  | ReviewDocTemplateValue[]
  | { [key: string]: ReviewDocTemplateValue };

export class ReviewDocTemplateRenderError extends Error {
  templateName: string;

  constructor(templateName: string, detail = "") {
    super(
      `심의자료 템플릿을 읽거나 렌더링할 수 없습니다: ${templateName}.${
        detail ? ` ${detail}` : ""
      } templates/review-docs의 파일을 확인해주세요.`,
    );
    this.name = "ReviewDocTemplateRenderError";
    this.templateName = templateName;
  }
}

const REQUIRED_TEMPLATE_MARKERS: Record<string, string[]> = {
  "song-review-request.docx": [
    "{#tracks}",
    "{/tracks}",
    "{album_title}",
    "{production_company_for_review}",
  ],
  "review-form.docx": [
    "{#tracks}",
    "{/tracks}",
    "{album_title}",
    "{company_name}",
    "{lyrics_with_translation}",
  ],
  "lyrics-all.docx": [
    "{#tracks}",
    "{/tracks}",
    "{manager_name}",
    "{lyrics_with_translation}",
  ],
  "lyrics-track.docx": [
    "{manager_name}",
    "{track_title_with_title_mark}",
    "{lyrics_with_translation}",
  ],
  "tbs-integrated.docx": [
    "{#albums}",
    "{/albums}",
    "{company_actual}",
    "{release_date_md}",
  ],
  "wbs-integrated.docx": [
    "{#albums}",
    "{/albums}",
    "{company_actual}",
    "{review_songs_text}",
  ],
  "pbc-integrated.docx": [
    "{#albums}",
    "{/albums}",
    "{album_title}",
    "{company_actual}",
  ],
  "lyrics-mv.docx": ["{artist_display}", "{track_title}", "{lyrics_with_translation}"],
};

const docxText = (xml: string) => xml
  .replace(/<w:(?:br|cr|tab)\b[^>]*\/>/g, " ")
  .replace(/<\/w:p>/g, " ")
  .replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/\s+/g, "").normalize("NFC");

/** Structural validation only. This does not claim Word/PDF visual verification. */
function validateRenderedDocx(zip: PizZip, templateName: string, data: Record<string, ReviewDocTemplateValue>, templateXml: string) {
  for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]) {
    if (!zip.file(name)) throw new ReviewDocTemplateRenderError(templateName, `DOCX 구성 파일 누락: ${name}.`);
  }
  const xml = zip.file("word/document.xml")!.asText();
  if (/<w:tblpPr\b/.test(xml) || /<w:trHeight\b[^>]*w:hRule="exact"/.test(xml)) {
    throw new ReviewDocTemplateRenderError(templateName, "겹침·가사 잘림 위험이 있는 플로팅 표 또는 고정 높이 행이 있습니다.");
  }
  const text = docxText(xml);
  const rows = (value: string) => (value.match(/<w:tr(?:\s[^>]*)?>/g) ?? []).length;
  if (templateName.endsWith("-integrated.docx") && Array.isArray(data.albums)) {
    if (rows(xml) !== rows(templateXml) - 1 + data.albums.length) {
      throw new ReviewDocTemplateRenderError(templateName, "통합신청서의 앨범 반복 행 수가 일치하지 않습니다.");
    }
  }
  if (templateName === "song-review-request.docx" && Array.isArray(data.tracks)) {
    if (rows(xml) !== rows(templateXml) - 1 + data.tracks.length) {
      throw new ReviewDocTemplateRenderError(templateName, "가요심의요청서의 트랙 반복 행 수가 일치하지 않습니다.");
    }
  }
  const required: string[] = [];
  const collect = (item: Record<string, ReviewDocTemplateValue>) => {
    for (const key of ["track_title", "lyrics_with_translation"]) {
      if (typeof item[key] === "string" && item[key]) required.push(item[key] as string);
    }
  };
  if (templateName.startsWith("lyrics-") || templateName === "review-form.docx") {
    if (Array.isArray(data.tracks) && templateName !== "lyrics-track.docx" && templateName !== "lyrics-mv.docx") {
      for (const track of data.tracks) if (track && typeof track === "object" && !Array.isArray(track)) collect(track);
    } else collect(data);
  }
  for (const value of required) {
    if (!text.includes(docxText(value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")))) {
      throw new ReviewDocTemplateRenderError(templateName, "필수 곡명 또는 가사 본문이 출력되지 않았습니다.");
    }
  }
  for (const marker of REQUIRED_TEMPLATE_MARKERS[templateName] ?? []) {
    const isLiteralInput = (value: ReviewDocTemplateValue): boolean =>
      typeof value === "string" ? value.includes(marker)
        : Array.isArray(value) ? value.some(isLiteralInput)
          : !!value && typeof value === "object" && Object.values(value).some(isLiteralInput);
    // A lyric may itself contain brace text. Docxtemplater treats inserted values
    // as data; the validator must not reinterpret that literal text as a command.
    if (text.includes(marker) && !isLiteralInput(data)) throw new ReviewDocTemplateRenderError(templateName, `미치환 placeholder: ${marker}.`);
  }
}

const sanitizeTemplateValue = (
  value: ReviewDocTemplateValue,
): ReviewDocTemplateValue => {
  if (typeof value === "string") {
    return value
      .normalize("NFC")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTemplateValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeTemplateValue(item),
      ]),
    );
  }
  return value;
};

export function renderReviewDocTemplate({
  template,
  templateName,
  data,
}: {
  template: Buffer;
  templateName: string;
  data: Record<string, ReviewDocTemplateValue>;
}) {
  try {
    const zip = new PizZip(template, { checkCRC32: true });
    const templateXml = zip.file("word/document.xml")?.asText() ?? "";
    const document = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    const templateText = document.getFullText();
    const missingMarkers = (REQUIRED_TEMPLATE_MARKERS[templateName] ?? []).filter(
      (marker) => !templateText.includes(marker),
    );
    if (missingMarkers.length > 0) {
      throw new ReviewDocTemplateRenderError(
        templateName,
        `필수 placeholder가 없습니다: ${missingMarkers.join(", ")}.`,
      );
    }

    document.render(
      sanitizeTemplateValue(data) as Record<string, ReviewDocTemplateValue>,
    );

    validateRenderedDocx(document.getZip(), templateName, sanitizeTemplateValue(data) as Record<string, ReviewDocTemplateValue>, templateXml);
    return document.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
  } catch (error) {
    if (error instanceof ReviewDocTemplateRenderError) throw error;
    throw new ReviewDocTemplateRenderError(templateName);
  }
}
