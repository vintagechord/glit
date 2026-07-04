import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchGenieAlbumReviewData,
  parseGenieAlbumPage,
  parseGenieSongPage,
} from "../src/lib/genie";
import { buildExternalReviewDocSubmissionBundles } from "../src/lib/admin/review-docs";

const genieAlbumHtml = `
  <div class="album-detail-infos">
    <div class="info-zone">
      <h2 class="name">Test Album</h2>
      <ul class="info-data">
        <li><span class="attr"><img alt="아티스트" /></span> <span class="value"><a>Test Artist</a></span></li>
        <li><span class="attr"><img alt="장르/스타일" /></span> <span class="value">Ballad / K-Pop</span></li>
        <li><span class="attr"><img alt="발매사" /></span> <span class="value">Test Distributor</span></li>
        <li><span class="attr"><img alt="기획사" /></span> <span class="value">Test Label</span></li>
        <li><span class="attr"><img alt="발매일" /></span> <span class="value">2026.07.04</span></li>
      </ul>
    </div>
  </div>
  <!-- E. 앨범 기본 정보 -->
  <table class="list-wrap"><tbody>
    <tr class="list" songId="222">
      <td class="number">1
      <td class="info">
        <a class="title ellipsis" title="First Song"><span class="icon icon-title">TITLE</span>First Song</a>
        <a class="artist ellipsis">Test Artist</a>
      </td>
    </tr>
    <tr class="list" songId="223">
      <td class="number">2
      <td class="info">
        <a class="title ellipsis" title="First Song (Inst.)">First Song (Inst.)</a>
        <a class="artist ellipsis">Test Artist</a>
      </td>
    </tr>
  </tbody></table>
`;

const genieSongHtml = `
  <h2 class="page-top-this"><a>Test Artist</a></h2>
  <div class="song-main-infos">
    <div class="info-zone">
      <h2 class="name">First Song</h2>
      <ul class="info-data">
        <li><span class="attr"><img alt="작사가" /></span> <span class="value"><span><a>Writer</a></span></span></li>
        <li><span class="attr"><img alt="작곡가" /></span> <span class="value"><span><a>Composer A</a>,<a>Composer B</a></span></span></li>
        <li><span class="attr"><img alt="편곡자" /></span> <span class="value"><span><a>Arranger</a></span></span></li>
      </ul>
    </div>
  </div>
  <!-- E. song-main-infos -->
  <pre id="pLyrics">
    <div>First Song - 03:20</div>
    <p>Line one

Line two</p>
  </pre>
`;

const genieInstSongHtml = `
  <h2 class="page-top-this"><a>Test Artist</a></h2>
  <div class="song-main-infos">
    <div class="info-zone">
      <h2 class="name">First Song (Inst.)</h2>
      <ul class="info-data">
        <li><span class="attr"><img alt="작사가" /></span> <span class="value"></span></li>
        <li><span class="attr"><img alt="작곡가" /></span> <span class="value"><span><a>Composer A</a>,<a>Composer B</a></span></span></li>
        <li><span class="attr"><img alt="편곡자" /></span> <span class="value"><span><a>Arranger</a></span></span></li>
      </ul>
    </div>
  </div>
  <!-- E. song-main-infos -->
`;

const melonAlbumHtml = `
  <div class="section_info">
    <span class="gubun">[싱글]</span>
    <div class="song_name"><strong class="none">앨범명</strong> Test Album</div>
    <div class="artist"><a class="artist_name"><span>Test Artist</span></a></div>
    <div class="meta">
      <dl class="list">
        <dt>발매일</dt><dd>2026.07.04</dd>
        <dt>장르</dt><dd>Ballad, Indie</dd>
        <dt>발매사</dt><dd>Test Distributor</dd>
        <dt>기획사</dt><dd>Test Label</dd>
      </dl>
    </div>
    <div class="button d_album_like"></div>
  </div>
  <tr data-group-items="cd1">
    <td><input name="input_check" value="111" title="First Song 곡 선택"></td>
    <td><span class="rank ">1</span></td>
    <td>
      <span title="타이틀 곡" class="bullet_icons title"></span>
      <a href="javascript:melon.play.playSong('28010101',111);">First Song</a>
      <div class="ellipsis rank02"><a class="artist_name">Test Artist</a></div>
    </td>
  </tr>
  <tr data-group-items="cd1">
    <td><input name="input_check" value="112" title="First Song (Inst.) 곡 선택"></td>
    <td><span class="rank ">2</span></td>
    <td>
      <a href="javascript:melon.play.playSong('28010101',112);">First Song (Inst.)</a>
      <div class="ellipsis rank02"><a class="artist_name">Test Artist</a></div>
    </td>
  </tr>
`;

const melonSongHtml = `
  <div class="song_name"><strong class="none">곡명</strong> First Song</div>
  <a class="artist_name"><span>Test Artist</span></a>
  <div class="lyric" id="d_video_summary">Line one<BR><BR>Line two</div>
  <ul class="list_person clfix">
    <li><a class="artist_name">Writer</a><span class="type">작사</span></li>
    <li><a class="artist_name">Composer A</a><span class="type">작곡</span></li>
    <li><a class="artist_name">Composer B</a><span class="type">작곡</span></li>
    <li><a class="artist_name">Arranger</a><span class="type">편곡</span></li>
  </ul>
`;

const melonInstSongHtml = `
  <div class="song_name"><strong class="none">곡명</strong> First Song (Inst.)</div>
  <a class="artist_name"><span>Test Artist</span></a>
  <ul class="list_person clfix">
    <li><a class="artist_name">Composer A</a><span class="type">작곡</span></li>
    <li><a class="artist_name">Composer B</a><span class="type">작곡</span></li>
    <li><a class="artist_name">Arranger</a><span class="type">편곡</span></li>
  </ul>
`;

const fetcher = async (input: Parameters<typeof fetch>[0]) => {
  const url = String(input);
  if (url.includes("genie.co.kr/detail/songInfo?xgnm=222")) {
    return new Response(genieSongHtml, { status: 200 });
  }
  if (url.includes("genie.co.kr/detail/songInfo?xgnm=223")) {
    return new Response(genieInstSongHtml, { status: 200 });
  }
  if (url.includes("genie.co.kr/detail/albumInfo")) {
    return new Response(genieAlbumHtml, { status: 200 });
  }
  if (url.includes("melon.com/song/detail.htm?songId=111")) {
    return new Response(melonSongHtml, { status: 200 });
  }
  if (url.includes("melon.com/song/detail.htm?songId=112")) {
    return new Response(melonInstSongHtml, { status: 200 });
  }
  if (url.includes("melon.com/album/detail.htm")) {
    return new Response(melonAlbumHtml, { status: 200 });
  }
  return new Response("", { status: 404 });
};

test("parseGenieAlbumPage extracts album metadata and tracks", () => {
  const album = parseGenieAlbumPage(genieAlbumHtml, "87816941");

  assert.equal(album.albumTitle, "Test Album");
  assert.equal(album.artistName, "Test Artist");
  assert.equal(album.releaseDate, "2026-07-04");
  assert.equal(album.genre, "Ballad / K-Pop");
  assert.equal(album.distributor, "Test Distributor");
  assert.equal(album.productionCompany, "Test Label");
  assert.equal(album.tracks.length, 2);
  assert.equal(album.tracks[0].songId, "222");
  assert.equal(album.tracks[0].trackNo, 1);
  assert.equal(album.tracks[0].trackTitle, "First Song");
  assert.equal(album.tracks[0].isTitle, true);
});

test("parseGenieSongPage extracts credits and lyrics without genie header", () => {
  const track = parseGenieSongPage(genieSongHtml, "222");

  assert.equal(track.trackTitle, "First Song");
  assert.equal(track.artistName, "Test Artist");
  assert.equal(track.lyricist, "Writer");
  assert.equal(track.composer, "Composer A, Composer B");
  assert.equal(track.arranger, "Arranger");
  assert.equal(track.lyrics, "Line one\n\nLine two");
});

test("parseGenieSongPage treats unavailable lyric notices as empty lyrics", () => {
  const track = parseGenieSongPage(
    genieSongHtml.replace(/<p>[\s\S]*?<\/p>/, "<p>가사 정보가 없습니다.</p>"),
    "222",
  );

  assert.equal(track.lyrics, "");
});

test("fetchGenieAlbumReviewData hydrates tracks and allows instrumental lyrics", async () => {
  const album = await fetchGenieAlbumReviewData(
    "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
    { fetcher },
  );

  assert.equal(album.tracks[0].lyrics, "Line one\n\nLine two");
  assert.equal(album.tracks[0].composer, "Composer A, Composer B");
  assert.equal(album.tracks[1].trackTitle, "First Song (Inst.)");
  assert.equal(album.tracks[1].lyrics, "");
});

test("buildExternalReviewDocSubmissionBundles cross-checks matching melon and genie data", async () => {
  const [bundle] = await buildExternalReviewDocSubmissionBundles(
    [
      "https://www.melon.com/album/detail.htm?albumId=123",
      "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
    ],
    { fetcher },
  );

  assert.equal(bundle.submission.title, "Test Album");
  assert.equal(bundle.submission.artist_name, "Test Artist");
  assert.equal(bundle.submission.genre, "Ballad / K-Pop");
  assert.equal(bundle.tracks.length, 2);
  assert.equal(bundle.tracks[0].composer, "Composer A, Composer B");
  assert.equal(bundle.tracks[0].lyrics, "Line one\n\nLine two");
  assert.match(String(bundle.tracks[0].notes), /멜론 곡 ID: 111/);
  assert.match(String(bundle.tracks[0].notes), /지니 곡 ID: 222/);
});

test("buildExternalReviewDocSubmissionBundles uses genie lyrics when melon lyrics are missing", async () => {
  const melonMissingLyricsFetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("melon.com/song/detail.htm?songId=111")) {
      return new Response(melonSongHtml.replace(/<div class="lyric"[\s\S]*?<\/div>/, ""), {
        status: 200,
      });
    }
    return fetcher(input);
  };

  const [bundle] = await buildExternalReviewDocSubmissionBundles(
    [
      "https://www.melon.com/album/detail.htm?albumId=123",
      "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
    ],
    { fetcher: melonMissingLyricsFetcher },
  );

  assert.equal(bundle.tracks[0].lyrics, "Line one\n\nLine two");
});

test("buildExternalReviewDocSubmissionBundles treats parenthesized English artist alias as same artist", async () => {
  const aliasedArtistFetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("genie.co.kr/detail/albumInfo")) {
      return new Response(genieAlbumHtml.replaceAll("Test Artist", "Test Artist (TA)"), {
        status: 200,
      });
    }
    if (url.includes("genie.co.kr/detail/songInfo?xgnm=222")) {
      return new Response(genieSongHtml.replaceAll("Test Artist", "Test Artist (TA)"), {
        status: 200,
      });
    }
    if (url.includes("genie.co.kr/detail/songInfo?xgnm=223")) {
      return new Response(genieInstSongHtml.replaceAll("Test Artist", "Test Artist (TA)"), {
        status: 200,
      });
    }
    return fetcher(input);
  };

  const [bundle] = await buildExternalReviewDocSubmissionBundles(
    [
      "https://www.melon.com/album/detail.htm?albumId=123",
      "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
    ],
    { fetcher: aliasedArtistFetcher },
  );

  assert.equal(bundle.submission.artist_name, "Test Artist (TA)");
  assert.equal(bundle.tracks[0].performer, "Test Artist (TA)");
});

test("buildExternalReviewDocSubmissionBundles tolerates contributor spacing differences", async () => {
  const spacedContributorFetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("genie.co.kr/detail/songInfo?xgnm=222")) {
      return new Response(genieSongHtml.replace("Composer A", "ComposerA"), {
        status: 200,
      });
    }
    if (url.includes("genie.co.kr/detail/songInfo?xgnm=223")) {
      return new Response(genieInstSongHtml.replace("Composer A", "ComposerA"), {
        status: 200,
      });
    }
    return fetcher(input);
  };

  const [bundle] = await buildExternalReviewDocSubmissionBundles(
    [
      "https://www.melon.com/album/detail.htm?albumId=123",
      "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
    ],
    { fetcher: spacedContributorFetcher },
  );

  assert.equal(bundle.tracks[0].composer, "ComposerA, Composer B");
});

test("buildExternalReviewDocSubmissionBundles treats company symbol variants as same company", async () => {
  const companyVariantFetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("genie.co.kr/detail/albumInfo")) {
      return new Response(
        genieAlbumHtml
          .replace("Test Distributor", "(주)Test Distributor")
          .replace("Test Label", "㈜Test Label"),
        { status: 200 },
      );
    }
    return fetcher(input);
  };

  const [bundle] = await buildExternalReviewDocSubmissionBundles(
    [
      "https://www.melon.com/album/detail.htm?albumId=123",
      "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
    ],
    { fetcher: companyVariantFetcher },
  );

  assert.equal(bundle.submission.distributor, "(주)Test Distributor");
  assert.equal(bundle.submission.production_company, "㈜Test Label");
});

test("buildExternalReviewDocSubmissionBundles uses melon lyrics when genie lyrics are missing", async () => {
  const genieMissingLyricsFetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("genie.co.kr/detail/songInfo?xgnm=222")) {
      return new Response(genieSongHtml.replace(/<p>[\s\S]*?<\/p>/, ""), {
        status: 200,
      });
    }
    return fetcher(input);
  };

  const [bundle] = await buildExternalReviewDocSubmissionBundles(
    [
      "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
      "https://www.melon.com/album/detail.htm?albumId=123",
    ],
    { fetcher: genieMissingLyricsFetcher },
  );

  assert.equal(bundle.tracks[0].lyrics, "Line one\n\nLine two");
});

test("buildExternalReviewDocSubmissionBundles rejects when every source misses lyrics", async () => {
  const allMissingLyricsFetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("melon.com/song/detail.htm?songId=111")) {
      return new Response(melonSongHtml.replace(/<div class="lyric"[\s\S]*?<\/div>/, ""), {
        status: 200,
      });
    }
    if (url.includes("genie.co.kr/detail/songInfo?xgnm=222")) {
      return new Response(genieSongHtml.replace(/<pre id="pLyrics"[\s\S]*?<\/pre>/, ""), {
        status: 200,
      });
    }
    return fetcher(input);
  };

  await assert.rejects(
    () =>
      buildExternalReviewDocSubmissionBundles(
        [
          "https://www.melon.com/album/detail.htm?albumId=123",
          "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
        ],
        { fetcher: allMissingLyricsFetcher },
      ),
    /가사를 가져오지 못한 곡이 있습니다/,
  );
});

test("buildExternalReviewDocSubmissionBundles prefers genie credits when melon differs", async () => {
  const conflictingFetcher = async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("genie.co.kr/detail/songInfo?xgnm=222")) {
      return new Response(genieSongHtml.replace("Writer", "Other Writer"), {
        status: 200,
      });
    }
    return fetcher(input);
  };

  const [bundle] = await buildExternalReviewDocSubmissionBundles(
    [
      "https://www.genie.co.kr/detail/albumInfo?axnm=87816941",
      "https://www.melon.com/album/detail.htm?albumId=123",
    ],
    { fetcher: conflictingFetcher },
  );

  assert.equal(bundle.tracks[0].lyricist, "Other Writer");
});
