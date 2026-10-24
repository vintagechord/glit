import assert from "node:assert/strict";
import test from "node:test";
import { getAlbumPackageLabel } from "../src/lib/album-package-label";

test("album package labels derive the unit from current station count, retaining diagnostic and unknown packages", () => {
  for (const count of [3, 7, 10, 13, 15]) assert.equal(getAlbumPackageLabel("이전 패키지 이름", count), `방송국 ${count}곳 · 앨범 1건`);
  assert.equal(getAlbumPackageLabel("[테스트] 100원 결제 검증", 3), "[테스트] 100원 결제 검증");
  assert.equal(getAlbumPackageLabel("기존 맞춤 패키지", null), "기존 맞춤 패키지");
  assert.equal(getAlbumPackageLabel(null, null, "패키지 미지정"), "패키지 미지정");
});
