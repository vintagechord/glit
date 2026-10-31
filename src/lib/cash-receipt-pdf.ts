import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  CASH_RECEIPT_PURPOSE_LABELS,
  maskCashReceiptIdentifier,
  type CashReceiptIssueMethod,
  type CashReceiptPurpose,
} from "@/lib/cash-receipts";

export type CashReceiptPdfInput = {
  orderId: string;
  purpose: CashReceiptPurpose;
  identifier: string;
  approvalNumber: string;
  issuedAt: string;
  issueMethod: CashReceiptIssueMethod | null;
  amountKrw: number;
  supplyKrw: number;
  vatKrw: number;
  goodName: string;
  canceled?: { at: string | null; reason: string | null } | null;
  business: { name: string; representative: string; registrationNumber: string; address: string; phone: string };
  printedAt?: Date;
};

const fontDir = path.join(process.cwd(), "src/assets/fonts/nanum-gothic");
let fontBytes: Promise<[Buffer, Buffer]> | undefined;
const loadFonts = () => (fontBytes ??= Promise.all([
  readFile(path.join(fontDir, "NanumGothic-Regular.ttf")),
  readFile(path.join(fontDir, "NanumGothic-Bold.ttf")),
]).catch((error) => { fontBytes = undefined; throw error; }));

const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const kst = (value: string | Date) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(typeof value === "string" ? new Date(value) : value);

const INK = rgb(0.067, 0.067, 0.067);
const MUTED = rgb(0.33, 0.33, 0.33);
const YELLOW = rgb(0.949, 0.812, 0.153);
const RED = rgb(0.851, 0.212, 0.173);

/** Wrap by measured width; Korean text has no spaces to rely on. */
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (font.widthOfTextAtSize(line + char, size) > width && line) { lines.push(line); line = char.trimStart(); }
      else line += char;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Printable confirmation of an issued cash receipt. The legal record is the
 * approval registered with the National Tax Service; this PDF reproduces it.
 */
export async function generateCashReceiptPdf(input: CashReceiptPdfInput) {
  const [regularBytes, boldBytes] = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`현금영수증 ${input.approvalNumber}`);
  doc.setAuthor(input.business.name);
  doc.setCreator("Onside");
  doc.setProducer("Onside");
  // pdf-lib's font subsetting drops Nanum Gothic glyphs, so embed whole fonts
  // (about 1.6MB per PDF, well under the 4.5MB function response limit).
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });
  const page: PDFPage = doc.addPage([420, 640]);
  const { width, height } = page.getSize();
  const margin = 28;
  const inner = width - margin * 2;

  page.drawRectangle({ x: margin, y: margin, width: inner, height: height - margin * 2, borderColor: INK, borderWidth: 2 });
  page.drawRectangle({ x: margin, y: height - margin - 64, width: inner, height: 64, color: YELLOW, borderColor: INK, borderWidth: 2 });
  page.drawText("현금영수증", { x: margin + 18, y: height - margin - 38, size: 22, font: bold, color: INK });
  page.drawText("CASH RECEIPT · 발급 확인서", { x: margin + 18, y: height - margin - 55, size: 9, font: regular, color: INK });
  const badge = input.canceled ? "발급 취소" : "승인";
  const badgeWidth = bold.widthOfTextAtSize(badge, 11) + 18;
  page.drawRectangle({ x: width - margin - 18 - badgeWidth, y: height - margin - 44, width: badgeWidth, height: 22, color: input.canceled ? RED : INK });
  page.drawText(badge, { x: width - margin - 9 - badgeWidth, y: height - margin - 37, size: 11, font: bold, color: rgb(1, 1, 1) });

  let y = height - margin - 92;
  const labelX = margin + 18;
  const valueX = margin + 118;
  const valueWidth = width - margin - 18 - valueX;
  const row = (label: string, value: string, options: { strong?: boolean; size?: number } = {}) => {
    const size = options.size ?? 10.5;
    const lines = wrap(value, options.strong ? bold : regular, size, valueWidth);
    page.drawText(label, { x: labelX, y, size: 9.5, font: regular, color: MUTED });
    lines.forEach((line, index) => page.drawText(line, { x: valueX, y: y - index * (size + 4), size, font: options.strong ? bold : regular, color: INK }));
    y -= Math.max(1, lines.length) * (size + 4) + 9;
  };
  const rule = () => { page.drawLine({ start: { x: labelX, y: y + 4 }, end: { x: width - margin - 18, y: y + 4 }, thickness: 1, color: INK }); y -= 12; };

  row("승인번호", input.approvalNumber, { strong: true, size: 13 });
  row("거래일시", kst(input.issuedAt));
  row("용도", CASH_RECEIPT_PURPOSE_LABELS[input.purpose]);
  row("발급 번호", maskCashReceiptIdentifier(input.identifier));
  row("품목", input.goodName);
  row("주문번호", input.orderId);
  rule();
  row("공급가액", won(input.supplyKrw));
  row("부가세", won(input.vatKrw));
  row("봉사료", won(0));
  row("합계", won(input.amountKrw), { strong: true, size: 14 });
  rule();
  row("가맹점", input.business.name, { strong: true });
  row("대표자", input.business.representative);
  row("사업자번호", input.business.registrationNumber);
  row("주소", input.business.address);
  row("문의", input.business.phone);
  row("발급 경로", input.issueMethod === "INICIS" ? "KG이니시스 현금영수증 발행" : "국세청 홈택스 발행");
  if (input.canceled) row("취소", [input.canceled.at ? kst(input.canceled.at) : "", input.canceled.reason ?? ""].filter(Boolean).join(" · ") || "발급이 취소되었습니다.");

  const note = "이 문서는 온사이드에서 발급한 현금영수증의 확인서입니다. 현금영수증은 국세청에 등록된 승인번호로 효력이 있으며, 국세청 홈택스(www.hometax.go.kr)나 손택스에서 조회할 수 있습니다.";
  const noteLines = wrap(note, regular, 8.5, inner - 36);
  let noteY = margin + 18 + noteLines.length * 12;
  for (const line of noteLines) { page.drawText(line, { x: labelX, y: noteY, size: 8.5, font: regular, color: MUTED }); noteY -= 12; }
  page.drawText(`출력 ${kst(input.printedAt ?? new Date())}`, { x: labelX, y: margin + 10, size: 7.5, font: regular, color: MUTED });
  return doc.save();
}
