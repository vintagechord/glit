import { analyzeLyricsProfanity } from "@/lib/profanity/check";
import type { ProfanityTerm } from "@/lib/profanity/legacy";

export const LYRICS_PROFANITY_BLOCK_MESSAGE =
  "욕설이 들리는 음원은 심의 접수가 불가합니다. 해당 곡을 제외하거나 욕설 구간을 마스킹한 음원과 가사를 제출해주세요.";
export const LYRICS_PROFANITY_MASKING_GUIDANCE =
  "무음·삐처리 등으로 실제 음원의 욕설을 마스킹한 경우에는 접수할 수 있습니다. 가사에도 해당 구간을 [무음] 또는 [삐처리]로 표시해주세요.";
export const LYRICS_PROFANITY_SUSPECTED_MESSAGE =
  "욕설로 들릴 수 있는 우회 표기가 있습니다. 실제 발음과 가사를 확인해주세요.";
export const LYRICS_PROFANITY_INCOMPLETE_MESSAGE =
  "가사가 길어 전체 검사를 완료하지 못했습니다. 가사를 확인하거나 고객센터에 문의해주세요.";

export const MAX_ALBUM_LYRICS_REVIEW_CHARACTERS = 500_000;

type LyricsReviewTrack = {
  lyrics?: string | null;
  translatedLyrics?: string | null;
};

export type AlbumLyricsReviewIssue = {
  trackIndex: number;
  field: "lyrics" | "translatedLyrics";
  kind: "profanity" | "suspected" | "incomplete";
  message: string;
  blocking: boolean;
};

/** The same input is reviewed before checkout and again on the server. */
export function getAlbumLyricsReviewIssues(
  tracks: LyricsReviewTrack[],
  extraTerms: ProfanityTerm[] = [],
): AlbumLyricsReviewIssue[] {
  const fields = ["lyrics", "translatedLyrics"] as const;
  let totalLength = 0;
  // Check the total before scanning so a crafted 100-track payload cannot
  // multiply the bounded per-text scanner into unbounded request work.
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    for (const field of fields) {
      totalLength += tracks[trackIndex][field]?.length ?? 0;
      if (totalLength > MAX_ALBUM_LYRICS_REVIEW_CHARACTERS) {
        return [{ trackIndex, field, kind: "incomplete", blocking: true,
          message: LYRICS_PROFANITY_INCOMPLETE_MESSAGE }];
      }
    }
  }

  const issues: AlbumLyricsReviewIssue[] = [];
  tracks.forEach((track, trackIndex) => {
    for (const field of fields) {
      const text = track[field] ?? "";
      if (!text.trim()) continue;
      const result = analyzeLyricsProfanity(text, extraTerms);
      if (result.truncated) {
        issues.push({ trackIndex, field, kind: "incomplete", blocking: true,
          message: LYRICS_PROFANITY_INCOMPLETE_MESSAGE });
      } else if (result.hasProfanity) {
        issues.push({ trackIndex, field, kind: "profanity", blocking: true,
          message: LYRICS_PROFANITY_BLOCK_MESSAGE });
      } else if (result.hasSuspectedProfanity) {
        issues.push({ trackIndex, field, kind: "suspected", blocking: false,
          message: LYRICS_PROFANITY_SUSPECTED_MESSAGE });
      }
    }
  });
  return issues;
}

export function getAlbumLyricsSubmissionError(
  tracks: LyricsReviewTrack[],
  extraTerms: ProfanityTerm[] = [],
): string | null {
  const issue = getAlbumLyricsReviewIssues(tracks, extraTerms).find(item => item.blocking);
  return issue ? `${issue.trackIndex + 1}번 트랙 · ${issue.field === "lyrics" ? "원문 가사" : "번역 가사"}: ${issue.message}` : null;
}
