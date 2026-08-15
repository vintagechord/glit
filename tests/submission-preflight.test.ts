import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlbumSubmissionPreflight,
  buildMvSubmissionPreflight,
  type AlbumSubmissionPreflightInput,
  type MvSubmissionPreflightInput,
} from "../src/lib/submission-preflight";

const validOnlineInput = (
  overrides: Partial<AlbumSubmissionPreflightInput> = {},
): AlbumSubmissionPreflightInput => ({
  submissionId: "00000000-0000-4000-8000-000000000001",
  selectedPackageId: "00000000-0000-4000-8000-000000000010",
  amountKrw: 49_000,
  isOneClick: false,
  applicationFormMode: "online",
  applicantName: "홍길동",
  applicantEmail: "artist@example.com",
  applicantPhone: "010-1234-5678",
  aiUsed: false,
  title: "테스트 앨범",
  artistName: "테스트 아티스트",
  artistNameKr: "테스트 아티스트",
  artistNameEn: "Test Artist",
  releaseDate: "2026-08-15",
  genre: "댄스",
  distributor: "테스트 유통사",
  productionCompany: "테스트 제작사",
  previousRelease: "없음",
  artistType: "SOLO",
  artistGender: "MIXED",
  tracks: [
    {
      trackTitle: "첫 번째 곡",
      performer: "가수",
      composer: "작곡가",
      lyrics: "한국어 가사",
      translatedLyrics: "",
      isTitle: true,
      broadcastSelected: true,
    },
  ],
  files: [{ originalName: "01-first-track.wav", mime: "audio/wav" }],
  uploads: [{ name: "01-first-track.wav", status: "done" }],
  filesSubmittedByEmail: false,
  ...overrides,
});

test("a complete online album passes preflight and enables the cart CTA", () => {
  const result = buildAlbumSubmissionPreflight(validOnlineInput());

  assert.equal(result.canSubmit, true);
  assert.deepEqual(result.blockingIssues, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.firstBlockingTarget, null);
});

test("preflight returns every problem with a direct step and field target", () => {
  const result = buildAlbumSubmissionPreflight(
    validOnlineInput({
      applicantEmail: "wrong-email",
      tracks: [
        {
          trackTitle: "",
          performer: "",
          composer: "",
          lyrics: "English lyrics",
          translatedLyrics: "",
          isTitle: false,
        },
        {
          trackTitle: "Second",
          performer: "Singer",
          composer: "Composer",
          isTitle: false,
        },
      ],
      files: [],
    }),
  );

  assert.equal(result.canSubmit, false);
  assert.deepEqual(result.firstBlockingTarget, {
    step: 3,
    field: "applicantEmail",
  });
  assert.deepEqual(
    result.blockingIssues
      .filter((item) => item.target.trackIndex === 0)
      .map((item) => [item.id, item.target]),
    [
      [
        "track.0.trackTitle",
        { step: 4, field: "trackTitle", trackIndex: 0 },
      ],
      [
        "track.0.performer",
        { step: 4, field: "performer", trackIndex: 0 },
      ],
      [
        "track.0.composer",
        { step: 4, field: "composer", trackIndex: 0 },
      ],
      [
        "track.0.translatedLyrics",
        { step: 4, field: "translatedLyrics", trackIndex: 0 },
      ],
    ],
  );
  assert.ok(
    result.blockingIssues.some((item) => item.id === "tracks.title-required"),
  );
  assert.ok(
    result.blockingIssues.some((item) => item.id === "files.audio-required"),
  );
});

test("one-click preflight skips the form-mode and track requirements", () => {
  const result = buildAlbumSubmissionPreflight(
    validOnlineInput({
      isOneClick: true,
      applicationFormMode: null,
      melonUrl: "https://www.melon.com/song/detail.htm?songId=1",
      title: "",
      artistName: "",
      artistNameKr: "",
      artistNameEn: "",
      tracks: [],
    }),
  );

  assert.equal(result.canSubmit, true);
  assert.equal(
    result.issues.some((item) => item.id === "application-mode.required"),
    false,
  );
  assert.equal(
    result.issues.some((item) => item.id.startsWith("track")),
    false,
  );
});

test("downloaded-form flow requires the completed form but not duplicate online fields", () => {
  const withoutForm = buildAlbumSubmissionPreflight(
    validOnlineInput({
      applicationFormMode: "upload",
      applicantName: "",
      applicantEmail: "",
      applicantPhone: "",
      title: "",
      artistName: "",
      artistNameKr: "",
      artistNameEn: "",
      tracks: [],
    }),
  );

  assert.deepEqual(
    withoutForm.blockingIssues.map((item) => item.id),
    ["files.application-form-required"],
  );

  const withForm = buildAlbumSubmissionPreflight(
    validOnlineInput({
      applicationFormMode: "upload",
      applicantName: "",
      applicantEmail: "",
      applicantPhone: "",
      title: "",
      artistName: "",
      artistNameKr: "",
      artistNameEn: "",
      tracks: [],
      files: [
        { originalName: "music.wav", mime: "audio/wav" },
        { originalName: "application.docx" },
      ],
    }),
  );
  assert.equal(withForm.canSubmit, true);
});

test("upload progress blocks submission while track and audio count mismatch only warns", () => {
  const pending = buildAlbumSubmissionPreflight(
    validOnlineInput({
      tracks: [
        {
          trackTitle: "One",
          performer: "Singer",
          composer: "Composer",
          isTitle: true,
        },
        {
          trackTitle: "Two",
          performer: "Singer",
          composer: "Composer",
          isTitle: false,
        },
      ],
      uploads: [{ name: "one.wav", status: "uploading" }],
      files: [{ originalName: "one.wav", mime: "audio/wav" }],
    }),
  );

  assert.equal(pending.canSubmit, false);
  assert.ok(
    pending.blockingIssues.some((item) => item.id === "files.upload-pending"),
  );
  assert.deepEqual(pending.warnings.map((item) => item.id), [
    "files.track-count-mismatch",
  ]);

  const completed = buildAlbumSubmissionPreflight(
    validOnlineInput({
      tracks: [
        {
          trackTitle: "One",
          performer: "Singer",
          composer: "Composer",
          isTitle: true,
        },
        {
          trackTitle: "Two",
          performer: "Singer",
          composer: "Composer",
          isTitle: false,
        },
      ],
      uploads: [{ name: "one.wav", status: "done" }],
      files: [{ originalName: "one.wav", mime: "audio/wav" }],
    }),
  );
  assert.equal(completed.canSubmit, true);
  assert.equal(completed.warnings.length, 1);
});

test("an edited cart submission needs one explicit price-change acknowledgement", () => {
  const input = validOnlineInput({
    existingCartSubmission: {
      submissionId: "00000000-0000-4000-8000-000000000001",
      packageId: "00000000-0000-4000-8000-000000000099",
      amountKrw: 35_000,
    },
  });
  const result = buildAlbumSubmissionPreflight(input);

  assert.equal(result.canSubmit, false);
  assert.equal(result.requiresPriceChangeConfirmation, true);
  assert.deepEqual(
    result.blockingIssues.find((item) => item.id === "cart.price-change"),
    {
      id: "cart.price-change",
      severity: "blocking",
      title: "결제 금액 변경",
      message:
        "패키지 또는 결제 금액이 변경되었습니다. 변경 내용을 확인해주세요.",
      target: { step: 1, field: "package" },
      acknowledgementKey: "cart-price-change",
      meta: {
        previousAmountKrw: 35_000,
        currentAmountKrw: 49_000,
        previousPackageId: "00000000-0000-4000-8000-000000000099",
        currentPackageId: "00000000-0000-4000-8000-000000000010",
      },
    },
  );

  const acknowledged = buildAlbumSubmissionPreflight({
    ...input,
    priceChangeAcknowledged: true,
  });
  assert.equal(acknowledged.canSubmit, true);
  assert.equal(acknowledged.requiresPriceChangeConfirmation, false);
});

const validMvInput = (
  overrides: Partial<MvSubmissionPreflightInput> = {},
): MvSubmissionPreflightInput => ({
  submissionId: "00000000-0000-4000-8000-000000000020",
  mvType: "MV_DISTRIBUTION",
  applicationFormMode: "online",
  selectedOptionCodes: [],
  onlineBaseSelected: true,
  amountKrw: 30_000,
  isGuest: true,
  title: "테스트 뮤직비디오",
  artistName: "테스트 아티스트",
  artistNameOfficial: "TEST ARTIST",
  releaseDate: "2026-08-15",
  director: "감독",
  leadActor: "주연",
  productionCompany: "제작사",
  agency: "소속사",
  albumTitle: "테스트 앨범",
  distributionCompany: "유통사",
  usage: "온라인 유통",
  songTitleKr: "노래",
  songTitleEn: "Song",
  songTitleOfficial: "노래 (Song)",
  composer: "작곡가",
  storyline: "처음부터 결말까지 작성한 줄거리",
  lyrics: "테스트 가사",
  aiUsed: false,
  guestName: "담당자",
  guestEmail: "mv@example.com",
  guestPhone: "010-1234-5678",
  files: [{ originalName: "music-video.mp4", mime: "video/mp4" }],
  uploads: [{ name: "music-video.mp4", status: "done" }],
  filesSubmittedByEmail: false,
  ...overrides,
});

test("a complete online MV passes preflight", () => {
  const result = buildMvSubmissionPreflight(validMvInput());

  assert.equal(result.canSubmit, true);
  assert.deepEqual(result.blockingIssues, []);
});

test("MV purpose options are checked for both broadcast and distribution flows", () => {
  const broadcast = buildMvSubmissionPreflight(
    validMvInput({
      mvType: "MV_BROADCAST",
      selectedOptionCodes: [],
      onlineBaseSelected: false,
      amountKrw: 0,
    }),
  );
  assert.deepEqual(broadcast.blockingIssues.map((item) => item.id).slice(0, 2), [
    "mv.broadcast-option-required",
    "mv.amount-required",
  ]);

  const distribution = buildMvSubmissionPreflight(
    validMvInput({
      selectedOptionCodes: [],
      onlineBaseSelected: false,
      amountKrw: 0,
    }),
  );
  assert.deepEqual(
    distribution.blockingIssues.map((item) => item.id).slice(0, 2),
    ["mv.distribution-option-required", "mv.amount-required"],
  );
});

test("an edited MV cart item requires one acknowledgement even when option prices match", () => {
  const input = validMvInput({
    selectedOptionCodes: ["MBC"],
    onlineBaseSelected: false,
    amountKrw: 30_000,
    existingCartSubmission: {
      submissionId: "00000000-0000-4000-8000-000000000020",
      selectedOptionCodes: [],
      onlineBaseSelected: true,
      amountKrw: 30_000,
    },
  });
  const result = buildMvSubmissionPreflight(input);

  assert.equal(result.canSubmit, false);
  assert.equal(result.requiresPriceChangeConfirmation, true);
  assert.deepEqual(
    result.blockingIssues.find((item) => item.id === "mv.cart-price-change"),
    {
      id: "mv.cart-price-change",
      severity: "blocking",
      title: "심의 옵션 변경",
      message:
        "심의 옵션 또는 결제 금액이 변경되었습니다. 변경 내용을 확인해주세요.",
      target: { step: 1, field: "reviewOptions" },
      acknowledgementKey: "cart-price-change",
      meta: {
        previousAmountKrw: 30_000,
        currentAmountKrw: 30_000,
      },
    },
  );

  assert.equal(
    buildMvSubmissionPreflight({
      ...input,
      priceChangeAcknowledged: true,
    }).canSubmit,
    true,
  );
});

test("MV preflight reports purpose, mode, application, upload, and amount issues with direct targets", () => {
  const result = buildMvSubmissionPreflight(
    validMvInput({
      mvType: null,
      applicationFormMode: null,
      onlineBaseSelected: false,
      amountKrw: 0,
      files: [],
      uploads: [],
    }),
  );

  assert.deepEqual(
    result.blockingIssues.map((item) => [item.id, item.target]),
    [
      ["mv.purpose-required", { step: 1, field: "mvPurpose" }],
      ["mv.amount-required", { step: 1, field: "reviewOptions" }],
      [
        "mv.application-mode-required",
        { step: 2, field: "applicationFormMode" },
      ],
      ["mv.video-required", { step: 4, field: "files" }],
    ],
  );
  assert.equal(result.canSubmit, false);
});

test("online MV lists all missing application fields instead of stopping at the first one", () => {
  const result = buildMvSubmissionPreflight(
    validMvInput({
      title: "",
      artistName: "",
      artistNameOfficial: "",
      composer: "",
      guestEmail: "wrong-email",
      guestPhone: "12",
      aiUsed: null,
    }),
  );

  assert.ok(result.blockingIssues.some((item) => item.id === "mv.title"));
  assert.ok(
    result.blockingIssues.some((item) => item.id === "mv.artist-name"),
  );
  assert.ok(result.blockingIssues.some((item) => item.id === "mv.composer"));
  assert.ok(
    result.blockingIssues.some((item) => item.id === "mv.guest-email-format"),
  );
  assert.ok(
    result.blockingIssues.some((item) => item.id === "mv.guest-phone-format"),
  );
  assert.ok(
    result.blockingIssues.some((item) => item.id === "mv.ai-usage-required"),
  );
});

test("downloaded MV form requires the form and video, while email delivery satisfies both", () => {
  const withoutFiles = buildMvSubmissionPreflight(
    validMvInput({
      applicationFormMode: "upload",
      title: "",
      artistName: "",
      files: [],
      uploads: [],
    }),
  );

  assert.deepEqual(withoutFiles.blockingIssues.map((item) => item.id), [
    "mv.video-required",
    "mv.application-form-required",
  ]);

  const emailDelivery = buildMvSubmissionPreflight(
    validMvInput({
      applicationFormMode: "upload",
      title: "",
      artistName: "",
      files: [],
      uploads: [],
      filesSubmittedByEmail: true,
    }),
  );
  assert.equal(emailDelivery.canSubmit, true);
});

test("MV upload failures and unfinished uploads block the final CTA", () => {
  const failed = buildMvSubmissionPreflight(
    validMvInput({ uploads: [{ name: "video.mp4", status: "error" }] }),
  );
  assert.deepEqual(failed.blockingIssues.map((item) => item.id), [
    "mv.files-upload-error",
  ]);

  const pending = buildMvSubmissionPreflight(
    validMvInput({ uploads: [{ name: "video.mp4", status: "uploading" }] }),
  );
  assert.deepEqual(pending.blockingIssues.map((item) => item.id), [
    "mv.files-upload-pending",
  ]);
});

test("a cart snapshot for another submission never triggers a price warning", () => {
  const result = buildAlbumSubmissionPreflight(
    validOnlineInput({
      existingCartSubmission: {
        submissionId: "00000000-0000-4000-8000-000000000002",
        packageId: "00000000-0000-4000-8000-000000000099",
        amountKrw: 1,
      },
    }),
  );

  assert.equal(result.canSubmit, true);
  assert.equal(result.requiresPriceChangeConfirmation, false);
});
