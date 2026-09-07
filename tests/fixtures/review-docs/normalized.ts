import { reviewDocumentDataSchema, type ReviewDocumentData } from "../../../src/lib/review-docs/model";

export function normalizedReviewFixture(): ReviewDocumentData {
  return reviewDocumentDataSchema.parse({
    mode: "album", applicationDate: "2026-09-07", sources: [],
    albums: [{
      id: "album-one", artistName: "검증 가수", artistNameEn: "", title: "가을의 노래",
      company: "검증 제작사", distributor: "검증 유통사", releaseDate: "2026-09-11", genre: "발라드",
      tracks: [{ id: "track-one", number: 1, title: "첫 번째 노래", isTitle: true, titleConfirmed: true,
        lyricist: "작사가", composer: "작곡가", arranger: "편곡가", lyrics: "오늘도 너를 기다려\n우리 함께 걸어가", lyricStatus: "provided",
      }, { id: "track-two", number: 2, title: "두 번째 노래 (Inst.)", isTitle: false,
        lyricist: "출력되지 않을 작사가", composer: "작곡가", lyrics: "", lyricStatus: "instrumental", instrumentalConfirmed: true,
      }],
    }],
  });
}

export function renderingReviewFixture(): ReviewDocumentData {
  const data = normalizedReviewFixture();
  const album = data.albums[0];
  album.title = "가을에 전하는 아주 긴 앨범 제목과 우리의 오래된 노래";
  album.company = "주식회사 오랜 시간 아름다운 음악을 만들어 온 검증 기획 제작사";
  const lines = ["I love you", "君を待っている", "오늘도 I love you", ...Array.from({ length: 62 }, (_, i) => `${i + 1}절 바람이 불어오는 길 위에서 우리 함께 걸어가`)];
  album.tracks[0].lyrics = lines.join("\n");
  album.tracks[0].translationSegments = [];
  for (const [source, translation, language] of [["I love you", "나는 너를 사랑해", "en"], ["君を待っている", "너를 기다리고 있어", "ja"]] as const) {
    let start = album.tracks[0].lyrics.indexOf(source);
    while (start >= 0) {
      album.tracks[0].translationSegments.push({ id: `seg-${start}`, start, end: start + source.length, source, translation, language, origin: "admin", confirmed: true });
      start = album.tracks[0].lyrics.indexOf(source, start + source.length);
    }
  }
  const second = structuredClone(album);
  second.id = "album-two"; second.title = "또 하나의 앨범"; second.artistName = "다른 가수";
  second.company = "두 번째 기획사"; second.tracks = [structuredClone(album.tracks[0])];
  second.tracks[0].id = "track-three"; second.tracks[0].title = "Mr. Sunshine";
  second.tracks[0].isTitle = false; second.tracks[0].titleConfirmed = false;
  second.tracks[0].lyrics = "다시 돌아오는 길\n같은 마음으로 기다려\n같은 마음으로 기다려";
  second.tracks[0].translationSegments = [];
  data.albums.push(second);
  return data;
}
