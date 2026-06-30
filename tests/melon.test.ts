import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchMelonAlbumReviewData,
  parseMelonAlbumPage,
  parseMelonSongPage,
} from "../src/lib/melon";
import { buildMelonReviewDocSubmissionBundles } from "../src/lib/admin/review-docs";

const albumHtml = `
  <div class="section_info">
    <span class="gubun">[싱글]</span>
    <div class="song_name"><strong class="none">앨범명</strong> Test Album</div>
    <div class="artist"><a class="artist_name"><span>Test Artist</span></a></div>
    <div class="meta">
      <dl class="list">
        <dt>발매일</dt><dd>2026.06.29</dd>
        <dt>장르</dt><dd>R&amp;B/Soul</dd>
        <dt>발매사</dt><dd>Test Distributor</dd>
        <dt>기획사</dt><dd>Test Label</dd>
      </dl>
    </div>
    <div class="button d_album_like"></div>
  </div>
  <tr data-group-items="cd1">
    <td><input name="input_check" value="111" title="First Song 곡 선택"></td>
    <td><span class="rank ">1</span></td>
    <td><a href="javascript:melon.link.goSongDetail('111');">곡정보</a></td>
    <td>
      <span title="타이틀 곡" class="bullet_icons title"></span>
      <a href="javascript:melon.play.playSong('28010101',111);" title="First Song 재생">First Song</a>
      <div class="ellipsis rank02"><a class="artist_name">Test Artist</a></div>
    </td>
  </tr>
`;

const songHtml = `
  <div class="song_name"><strong class="none">곡명</strong> First Song</div>
  <a class="artist_name"><span>Test Artist</span></a>
  <div class="lyric" id="d_video_summary"><!-- comment -->Line one<BR><BR>Line two</div>
  <ul class="list_person clfix">
    <li><a class="artist_name">Writer</a><span class="type">작사</span></li>
    <li><a class="artist_name">Composer A</a><span class="type">작곡</span></li>
    <li><a class="artist_name">Composer B</a><span class="type">작곡</span></li>
    <li><a class="artist_name">Arranger</a><span class="type">편곡</span></li>
  </ul>
`;

test("parseMelonAlbumPage extracts album metadata and tracks", () => {
  const album = parseMelonAlbumPage(albumHtml, "123");

  assert.equal(album.albumTitle, "Test Album");
  assert.equal(album.albumType, "싱글");
  assert.equal(album.artistName, "Test Artist");
  assert.equal(album.releaseDate, "2026-06-29");
  assert.equal(album.genre, "R&B/Soul");
  assert.equal(album.distributor, "Test Distributor");
  assert.equal(album.productionCompany, "Test Label");
  assert.equal(album.tracks.length, 1);
  assert.equal(album.tracks[0].songId, "111");
  assert.equal(album.tracks[0].trackNo, 1);
  assert.equal(album.tracks[0].trackTitle, "First Song");
  assert.equal(album.tracks[0].isTitle, true);
});

test("parseMelonSongPage extracts credits and lyrics with line breaks", () => {
  const track = parseMelonSongPage(songHtml, "111");

  assert.equal(track.trackTitle, "First Song");
  assert.equal(track.artistName, "Test Artist");
  assert.equal(track.lyricist, "Writer");
  assert.equal(track.composer, "Composer A, Composer B");
  assert.equal(track.arranger, "Arranger");
  assert.equal(track.lyrics, "Line one\n\nLine two");
});

test("fetchMelonAlbumReviewData requires lyrics", async () => {
  const fetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    return new Response(url.includes("song/detail") ? songHtml : albumHtml, {
      status: 200,
    });
  };

  const album = await fetchMelonAlbumReviewData(
    "https://www.melon.com/album/detail.htm?albumId=123",
    { fetcher },
  );

  assert.equal(album.tracks[0].lyrics, "Line one\n\nLine two");
  assert.equal(album.tracks[0].composer, "Composer A, Composer B");
});

test("buildMelonReviewDocSubmissionBundles maps melon albums to review doc bundles", async () => {
  const fetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    return new Response(url.includes("song/detail") ? songHtml : albumHtml, {
      status: 200,
    });
  };

  const [bundle] = await buildMelonReviewDocSubmissionBundles(
    ["https://www.melon.com/album/detail.htm?albumId=123"],
    { fetcher },
  );

  assert.equal(bundle.submission.id, "melon-123");
  assert.equal(bundle.submission.title, "Test Album");
  assert.equal(bundle.submission.artist_name, "Test Artist");
  assert.equal(bundle.submission.is_oneclick, false);
  assert.equal(bundle.tracks[0].track_title, "First Song");
  assert.equal(bundle.tracks[0].performer, "Test Artist");
  assert.equal(bundle.tracks[0].lyrics, "Line one\n\nLine two");
});
