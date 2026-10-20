import assert from "node:assert/strict";
import test from "node:test";
import { radioExternalUrl } from "../src/features/submissions/radio-request-ui";

test("saved radio links only navigate to absolute HTTPS URLs without credentials", () => {
  assert.equal(radioExternalUrl(" https://www.arirang.com/radio/125/board/674?post=1#reply "), "https://www.arirang.com/radio/125/board/674?post=1#reply");
  for (const value of [undefined, "", "not a URL", "/radio/125", "//example.com/post", "http://example.com/post", "javascript:alert(1)", "data:text/html,test", "https://user:password@example.com/post", "https://user@example.com/post"]) {
    assert.equal(radioExternalUrl(value), null);
  }
});
