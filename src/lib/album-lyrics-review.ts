import { analyzeLyricsProfanity } from "@/lib/profanity/check";
import type { ProfanityTerm } from "@/lib/profanity/legacy";

// Owner decision 2026-11-26: the check only informs. An application with
// profanity can always be submitted; the broadcasters decide. Nothing here
// blocks a step, the preflight or the server action.
export const LYRICS_PROFANITY_NOTICE_MESSAGE =
  "욕설로 보이는 표현이 있습니다. 방송 심의에서 부적격이 될 수 있으니 표시된 부분을 확인해주세요.";
export const LYRICS_PROFANITY_MASKING_GUIDANCE =
  "실제 음원에서 무음·삐처리했다면 가사에도 [무음] 또는 [삐처리]로 표시해주세요.";
export const LYRICS_PROFANITY_SUSPECTED_MESSAGE =
  "욕설로 들릴 수 있는 표현이 있습니다. 실제 발음과 가사를 확인해주세요.";
export const LYRICS_PROFANITY_INCOMPLETE_MESSAGE =
  "가사가 길어 일부만 검사했습니다. 나머지는 직접 확인해주세요.";

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
};

/** Notices for the wizard and the preflight; none of them blocks. */
export function getAlbumLyricsReviewIssues(
  tracks: LyricsReviewTrack[],
  extraTerms: ProfanityTerm[] = [],
): AlbumLyricsReviewIssue[] {
  const fields = ["lyrics", "translatedLyrics"] as const;
  let totalLength = 0;
  // Check the total before scanning so a crafted 100-track payload cannot
  // multiply the bounded per-text scanner into unbounded work.
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    for (const field of fields) {
      totalLength += tracks[trackIndex][field]?.length ?? 0;
      if (totalLength > MAX_ALBUM_LYRICS_REVIEW_CHARACTERS) {
        return [{ trackIndex, field, kind: "incomplete", message: LYRICS_PROFANITY_INCOMPLETE_MESSAGE }];
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
        issues.push({ trackIndex, field, kind: "incomplete", message: LYRICS_PROFANITY_INCOMPLETE_MESSAGE });
      } else if (result.hasProfanity) {
        issues.push({ trackIndex, field, kind: "profanity", message: LYRICS_PROFANITY_NOTICE_MESSAGE });
      } else if (result.hasSuspectedProfanity) {
        issues.push({ trackIndex, field, kind: "suspected", message: LYRICS_PROFANITY_SUSPECTED_MESSAGE });
      }
    }
  });
  return issues;
}
