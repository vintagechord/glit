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
};

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
    const zip = new PizZip(template);
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

    return document.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
  } catch (error) {
    if (error instanceof ReviewDocTemplateRenderError) throw error;
    throw new ReviewDocTemplateRenderError(templateName);
  }
}
