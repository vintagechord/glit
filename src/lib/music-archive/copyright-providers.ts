import { z } from "zod";

/** These are official navigation adapters, not licensed data APIs or rights verification. */
export const COPYRIGHT_POLICY_CHECKED_AT = "2026-09-08";
export const copyrightAgencySchema = z.enum(["komca", "koscap"]);
export type CopyrightAgency = z.infer<typeof copyrightAgencySchema>;
const queryText = z.string().trim().max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "검색어에는 줄바꿈이나 제어문자를 넣을 수 없습니다.").default("");
export const copyrightLookupInputSchema = z.object({
  agency: copyrightAgencySchema,
  title: queryText,
  writer: queryText,
}).strict().refine(input => Boolean(input.title || input.writer), "곡 제목 또는 저작자명을 입력해주세요.");
export type CopyrightLookupInput = z.input<typeof copyrightLookupInputSchema>;

export type PreparedCopyrightLookup = {
  agency: CopyrightAgency;
  query: { title: string; writer: string };
  officialUrl: string;
  copyText: string;
};

const officialSearchUrls: Record<CopyrightAgency, string> = {
  komca: "https://www.komca.or.kr/srch2/srch_01.jsp",
  koscap: "https://www.koscap.or.kr/v2/music/search_list",
};

export function prepareCopyrightLookup(input: CopyrightLookupInput): PreparedCopyrightLookup {
  const { agency, title, writer } = copyrightLookupInputSchema.parse(input);
  const url = new URL(officialSearchUrls[agency]);
  if (agency === "koscap") {
    // Exact GET fields observed in KOSCAP's public form on 2026-09-08.
    // This URL is opened by the user. The server never fetches or proxies it.
    url.searchParams.set("f_song_name", title);
    url.searchParams.set("f_artist", writer);
    url.searchParams.set("page_cnt", "10");
  }
  return {
    agency, query: { title, writer }, officialUrl: url.toString(),
    copyText: [title ? `작품명: ${title}` : "", writer ? `저작자: ${writer}` : ""].filter(Boolean).join("\n"),
  };
}
