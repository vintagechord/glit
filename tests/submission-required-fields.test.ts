import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  validateAlbumSubmittedFields,
  validateMvSubmittedFields,
  validateSubmittedFiles,
} from "../src/lib/submission-required-fields";

const validAlbum = {
  isAdminReviewer: false,
  externalApplicationForm: false,
  isOneClick: false,
  applicantName: "Applicant",
  applicantEmail: "applicant@example.com",
  applicantPhone: "01012345678",
  aiUsed: false,
  title: "Album",
  artistName: "Artist",
  artistNameKr: "아티스트",
  artistNameEn: "Artist",
  releaseDate: "2026-08-15",
  genre: "POP",
  distributor: "Distributor",
  productionCompany: "Production",
  previousRelease: "None",
  artistType: "SOLO",
  artistGender: "MIXED",
  tracks: [
    {
      trackTitle: "Song",
      composer: "Composer",
      isTitle: true,
      broadcastSelected: true,
    },
  ],
};

test("normal album submission enforces the same required fields as the wizard", () => {
  assert.equal(validateAlbumSubmittedFields(validAlbum), null);

  for (const field of [
    "applicantName",
    "applicantEmail",
    "applicantPhone",
    "title",
    "artistName",
    "artistNameKr",
    "artistNameEn",
    "releaseDate",
    "genre",
    "distributor",
    "productionCompany",
    "previousRelease",
    "artistType",
    "artistGender",
  ] as const) {
    assert.ok(
      validateAlbumSubmittedFields({ ...validAlbum, [field]: "" }),
      `album ${field} must be required`,
    );
  }

  assert.ok(validateAlbumSubmittedFields({ ...validAlbum, aiUsed: null }));
  assert.ok(
    validateAlbumSubmittedFields({
      ...validAlbum,
      artistType: "GROUP",
      artistMembers: "",
    }),
  );
  assert.ok(
    validateAlbumSubmittedFields({
      ...validAlbum,
      tracks: [{ trackTitle: "", composer: "Composer", isTitle: true }],
    }),
  );
  assert.ok(
    validateAlbumSubmittedFields({
      ...validAlbum,
      tracks: [{ trackTitle: "Song", composer: "", isTitle: true }],
    }),
  );
});

test("album title/broadcast rules and one-click requirements cannot be bypassed", () => {
  assert.ok(
    validateAlbumSubmittedFields({
      ...validAlbum,
      tracks: [
        { trackTitle: "1", composer: "C", isTitle: true, broadcastSelected: true },
        { trackTitle: "2", composer: "C", broadcastSelected: true },
        { trackTitle: "3", composer: "C", broadcastSelected: false },
        { trackTitle: "4", composer: "C", broadcastSelected: false },
      ],
    }),
  );
  assert.equal(
    validateAlbumSubmittedFields({
      ...validAlbum,
      tracks: [
        { trackTitle: "1", composer: "C", isTitle: true, broadcastSelected: true },
        { trackTitle: "2", composer: "C", broadcastSelected: true },
        { trackTitle: "3", composer: "C", broadcastSelected: true },
        { trackTitle: "4", composer: "C", broadcastSelected: false },
      ],
    }),
    null,
  );
  assert.ok(
    validateAlbumSubmittedFields({
      ...validAlbum,
      isOneClick: true,
      melonUrl: "",
    }),
  );
  assert.equal(
    validateAlbumSubmittedFields({
      ...validAlbum,
      isOneClick: true,
      melonUrl: "https://www.melon.com/album/detail.htm?albumId=1",
      tracks: [],
    }),
    null,
  );
});

test("downloaded album forms require AI declaration but use the attached form fields", () => {
  assert.equal(
    validateAlbumSubmittedFields({
      ...validAlbum,
      externalApplicationForm: true,
      title: "",
      applicantName: "",
      tracks: [],
    }),
    null,
  );
  assert.ok(
    validateAlbumSubmittedFields({
      ...validAlbum,
      externalApplicationForm: true,
      aiUsed: undefined,
      tracks: [],
    }),
  );
});

const validMv = {
  isAdminReviewer: false,
  externalApplicationForm: false,
  aiUsed: false,
  title: "Video",
  artistName: "Artist",
  artistNameOfficial: "Artist",
  releaseDate: "2026-08-15",
  director: "Director",
  leadActor: "Actor",
  productionCompany: "Production",
  agency: "Agency",
  albumTitle: "Album",
  distributionCompany: "Distributor",
  usage: "Broadcast",
  songTitleKr: "노래",
  songTitleEn: "Song",
  songTitleOfficial: "Song",
  composer: "Composer",
  storyline: "Story",
  lyrics: "Lyrics",
};

test("normal MV submission enforces every wizard-required field", () => {
  assert.equal(validateMvSubmittedFields(validMv), null);
  for (const field of [
    "title",
    "artistName",
    "artistNameOfficial",
    "releaseDate",
    "director",
    "leadActor",
    "productionCompany",
    "agency",
    "albumTitle",
    "distributionCompany",
    "usage",
    "songTitleKr",
    "songTitleEn",
    "songTitleOfficial",
    "composer",
    "storyline",
    "lyrics",
  ] as const) {
    assert.ok(
      validateMvSubmittedFields({ ...validMv, [field]: "" }),
      `MV ${field} must be required`,
    );
  }
  assert.ok(validateMvSubmittedFields({ ...validMv, aiUsed: undefined }));
});

test("downloaded MV forms still require AI declaration", () => {
  assert.equal(
    validateMvSubmittedFields({
      ...validMv,
      externalApplicationForm: true,
      title: "",
    }),
    null,
  );
  assert.ok(
    validateMvSubmittedFields({
      ...validMv,
      externalApplicationForm: true,
      aiUsed: null,
    }),
  );
});

test("submitted media and downloaded application forms are enforced server-side", () => {
  const base = {
    isAdminReviewer: false,
    filesSubmittedByEmail: false,
  };
  assert.ok(validateSubmittedFiles({ ...base, kind: "ALBUM" as const, files: [] }));
  assert.equal(
    validateSubmittedFiles({
      ...base,
      kind: "ALBUM",
      files: [{ originalName: "track.wav", mime: "audio/wav" }],
    }),
    null,
  );
  assert.ok(
    validateSubmittedFiles({
      ...base,
      kind: "MV",
      externalApplicationForm: true,
      files: [{ originalName: "video.mp4", mime: "video/mp4" }],
    }),
  );
  assert.equal(
    validateSubmittedFiles({
      ...base,
      kind: "MV",
      externalApplicationForm: true,
      files: [
        { originalName: "video.mp4", mime: "video/mp4" },
        { originalName: "application.docx", mime: "application/octet-stream" },
      ],
    }),
    null,
  );
  assert.equal(
    validateSubmittedFiles({
      ...base,
      kind: "ALBUM",
      filesSubmittedByEmail: true,
      files: [],
    }),
    null,
  );
});

test("both wizards explicitly bind the downloaded-form mode into the server action", () => {
  for (const path of [
    "src/features/submissions/album-wizard.tsx",
    "src/features/submissions/mv-wizard.tsx",
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.equal(
      (source.match(/externalApplicationForm: isDownloadedApplicationFlow/g) ?? [])
        .length,
      2,
      `${path} must bind both draft and submit calls`,
    );
  }
});
