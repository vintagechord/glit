import assert from "node:assert/strict";
import test from "node:test";

import {
  showCenteredAlert,
  showCenteredConfirm,
} from "../src/lib/centered-dialog";

test("centered dialogs have safe server-side fallbacks", async () => {
  await assert.doesNotReject(() => showCenteredAlert("안내"));
  assert.equal(await showCenteredConfirm("확인"), false);
});
