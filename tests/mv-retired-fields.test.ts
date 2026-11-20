import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { retiredMvFieldUpdate } from "../src/lib/mv-retired-fields";

// The MV wizard stopped asking for 제작일 and 사업자등록번호 (and 포맷), but
// admin direct intake and reference imports still fill them. A customer save
// that does not send them must keep what is stored instead of writing null.

test("a save that omits the retired MV inputs leaves the stored values alone", () => {
  assert.deepEqual(retiredMvFieldUpdate({}), {});
});

test("a client that still sends the retired inputs writes them", () => {
  assert.deepEqual(
    retiredMvFieldUpdate({ format: " 4K ", productionDate: "2026-11-01", businessRegNo: " 123-45-67890 " }),
    { mv_format: "4K", mv_production_date: "2026-11-01", mv_business_reg_no: "123-45-67890" },
  );
  assert.deepEqual(
    retiredMvFieldUpdate({ format: " ", productionDate: "", businessRegNo: "  " }),
    { mv_format: null, mv_production_date: null, mv_business_reg_no: null },
  );
});

test("the MV save builds its retired columns through the helper only", () => {
  const source = readFileSync(new URL("../src/features/submissions/actions.ts", import.meta.url), "utf8");
  assert.match(source, /\.\.\.retiredMvFieldUpdate\(parsed\.data\)/);
  assert.doesNotMatch(source, /mv_production_date:\s*parsed\.data\.productionDate/);
  assert.doesNotMatch(source, /mv_business_reg_no:\s*parsed\.data\.businessRegNo/);
  assert.doesNotMatch(source, /mv_format:\s*parsed\.data\.format/);
});
