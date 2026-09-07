import assert from "node:assert/strict";
import test from "node:test";

import {
  getReleasedAlbumUrlError,
  parseReleasedAlbumUrl,
} from "../src/lib/released-album-url";

test("Melon and Genie album pages normalize to canonical HTTPS URLs", () => {
  for (const value of [
    "https://www.melon.com/album/detail.htm?albumId=12345",
    " http://m2.melon.com/album/detail.htm?albumId=12345&ref=share ",
    "https://m.melon.com/album/music.htm?albumId=12345#track",
  ]) {
    assert.deepEqual(parseReleasedAlbumUrl(value), {
      provider: "melon",
      albumId: "12345",
      canonicalUrl: "https://www.melon.com/album/detail.htm?albumId=12345",
    });
  }
  for (const value of [
    "https://www.genie.co.kr/detail/albumInfo?axnm=12345",
    "http://mw.genie.co.kr/detail/albumInfo?axnm=12345&ref=share",
  ]) {
    assert.deepEqual(parseReleasedAlbumUrl(value), {
      provider: "genie",
      albumId: "12345",
      canonicalUrl: "https://www.genie.co.kr/detail/albumInfo?axnm=12345",
    });
  }
});

test("released album URLs reject unrelated pages, malformed IDs and untrusted origins", () => {
  for (const value of [
    "",
    "12345",
    "https://www.melon.com/song/detail.htm?songId=12345",
    "https://www.genie.co.kr/detail/songInfo?xgnm=12345",
    "https://www.melon.com/album/detail.htm",
    "https://www.genie.co.kr/detail/albumInfo?axnm=0",
    "https://www.genie.co.kr/detail/albumInfo?axnm=123abc",
    "https://www.melon.com.evil.example/album/detail.htm?albumId=12345",
    "https://evil.example/album/detail.htm?albumId=12345",
    "https://www.melon.com@evil.example/album/detail.htm?albumId=12345",
    "https://user@www.melon.com/album/detail.htm?albumId=12345",
    "https://www.genie.co.kr:8080/detail/albumInfo?axnm=12345",
    "ftp://www.melon.com/album/detail.htm?albumId=12345",
  ]) {
    assert.equal(parseReleasedAlbumUrl(value), null, value);
    assert.ok(getReleasedAlbumUrlError(value), value);
  }
  assert.equal(
    getReleasedAlbumUrlError("https://www.genie.co.kr/detail/albumInfo?axnm=12345"),
    null,
  );
});
