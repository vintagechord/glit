import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Leaving a wizard inside the app (a header link, the KO/EN switch, browser
// back) unmounts it without closing the tab, so beforeunload never fires.
// Its upload run has to stop there: otherwise the transfer keeps going in the
// background and keeps writing the multipart resume record that a later
// upload of the same file reads, and the two runs race over the same parts
// until the visible one fails. The same holds when a file is switched to
// email delivery mid-upload.
const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const wizards = [
  {
    name: "album",
    source: read("src/features/submissions/album-wizard.tsx"),
    runRef: "audioUploadRunRef",
    requestsRef: "audioUploadRequestsRef",
    stop: "stopAudioUploads",
    track: "trackAudioUploadRequest",
    multipartStart: "const uploadMultipartAudioFile",
    multipartEnd: "const uploadWithProgress",
  },
  {
    name: "MV",
    source: read("src/features/submissions/mv-wizard.tsx"),
    runRef: "videoUploadRunRef",
    requestsRef: "videoUploadRequestsRef",
    stop: "stopVideoUploads",
    track: "trackVideoUploadRequest",
    multipartStart: "const uploadMultipartFile",
    multipartEnd: "const uploadWithProgress",
  },
] as const;

const sliceBetween = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return source.slice(from, to);
};

for (const wizard of wizards) {
  test(`${wizard.name} uploads stop when the wizard unmounts`, () => {
    const { source } = wizard;
    const stop = sliceBetween(
      source,
      `const ${wizard.stop} = React.useCallback(`,
      "}, []);",
    );
    // The run goes stale first, so the abort below reads as a stop and not
    // as the watchdog's retryable stall.
    assert.match(stop, new RegExp(`${wizard.runRef}\\.current \\+= 1;`));
    assert.match(stop, new RegExp(`${wizard.requestsRef}\\.current`));
    assert.match(stop, /\.abort\(\)/);
    assert.ok(
      stop.indexOf(`${wizard.runRef}.current += 1`) < stop.indexOf(".abort()"),
    );
    assert.match(
      source,
      new RegExp(
        `React\\.useEffect\\(\\(\\) => \\(\\) => ${wizard.stop}\\(\\), \\[${wizard.stop}\\]\\);`,
      ),
    );
  });

  test(`${wizard.name} upload requests can all be stopped and never start for a stopped run`, () => {
    const { source } = wizard;
    // A stable callback: as a plain function called inside the request
    // promises it makes React Compiler skip the wizard's memoized callbacks.
    const track = sliceBetween(
      source,
      `const ${wizard.track} = React.useCallback((`,
      "}, []);",
    );
    assert.match(track, /return true;\s*$/);
    assert.match(
      track,
      new RegExp(
        `if \\(run !== ${wizard.runRef}\\.current\\) \\{\\s*reject\\(createUploadStoppedError\\(\\)\\);\\s*return false;`,
      ),
    );
    assert.match(track, /addEventListener\("loadend"/);
    assert.match(
      track,
      new RegExp(
        `addEventListener\\("abort", \\(\\) => \\{\\s*if \\(run !== ${wizard.runRef}\\.current\\) reject\\(createUploadStoppedError\\(\\)\\);`,
      ),
    );
    assert.match(
      source,
      /const createUploadStoppedError = \(\) =>\s*Object\.assign\(new Error\("[^"]+"\), \{ final: true \}\);/,
    );

    const requests = source.match(/new XMLHttpRequest\(\)/g) ?? [];
    const tracked =
      source.match(
        new RegExp(
          `const xhr = new XMLHttpRequest\\(\\);\\s*if \\(!${wizard.track}\\(xhr, reject, run\\)\\) return;\\s*watchUploadProgress\\(xhr, reject\\);`,
          "g",
        ),
      ) ?? [];
    assert.ok(requests.length > 0);
    assert.equal(tracked.length, requests.length, "every upload request is tracked");

    // uploadFiles hands its run to the transfer it starts.
    assert.match(
      source,
      /const uploadResult = await uploadWithProgress\(\s*file,[\s\S]*?\},\s*uploadRun,\s*\);/,
    );
  });

  test(`${wizard.name} stopped multipart runs neither sign nor complete`, () => {
    const multipart = sliceBetween(
      wizard.source,
      wizard.multipartStart,
      wizard.multipartEnd,
    );
    const stale = `if (run !== ${wizard.runRef}.current)`;
    const signAt = multipart.indexOf("sign: async (partNumbers) => {");
    assert.ok(signAt >= 0, "the sign callback checks the run");
    assert.ok(multipart.indexOf(stale, signAt) > signAt);
    assert.ok(
      multipart.indexOf(stale, signAt) < multipart.indexOf("signMultipartParts(", signAt),
    );
    const completeAt = multipart.indexOf('"/api/uploads/multipart/complete"');
    const lastStaleCheck = multipart.lastIndexOf(
      `${stale} throw createUploadStoppedError();`,
      completeAt,
    );
    assert.ok(
      lastStaleCheck > multipart.indexOf("await uploadMultipartParts("),
      "a stopped run leaves the upload open for the resume record instead of completing it",
    );
  });
}

test("switching to email delivery stops the running upload", () => {
  const album = wizards[0].source;
  const handOff = sliceBetween(
    album,
    "const handOffAudioByEmail = React.useCallback(",
    "}, [",
  );
  assert.match(handOff, /stopAudioUploads\(\);/);
  assert.doesNotMatch(handOff, /audioUploadRunRef\.current \+= 1/);

  const mv = wizards[1].source;
  const deliveryMode = sliceBetween(
    mv,
    "const selectUploadDeliveryMode = React.useCallback(",
    "const applyStoredDraft",
  );
  assert.match(deliveryMode, /stopVideoUploads\(\);/);
  assert.doesNotMatch(deliveryMode, /videoUploadRunRef\.current \+= 1/);
});

test("retry loops end at once for a stopped run", () => {
  const album = wizards[0].source;
  const single = sliceBetween(
    album,
    "const putPresignedFile = () =>",
    "return completeUpload(key);",
  );
  assert.match(
    single,
    /catch \(error\) \{\s*if \(isFinalUploadError\(error\)\) throw error;\s*lastError = error;/,
  );
  assert.match(
    single,
    /\} catch \(error\) \{\s*if \(isFinalUploadError\(error\)\) throw error;\s*console\.warn\("\[Upload\]\[album\] presigned PUT failed/,
  );

  const mv = wizards[1].source;
  assert.match(
    mv,
    /if \(attempt >= singlePutAttempts \|\| isFinalUploadError\(error\)\) throw error;/,
  );
});
