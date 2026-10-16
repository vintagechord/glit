import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RETIRED_ONLINE_MBC_PAYMENT_MESSAGE,
  validateMvPaymentStations,
} from "../src/lib/submission-payment-stations";

type Row = Record<string, unknown>;

function dbFixture(submissions: Row[], fail = false) {
  const calls: string[] = [];
  const db = {
    from(table: string) {
      calls.push(table);
      let rows = submissions;
      const query = {
        select() { return query; },
        in(column: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        then(resolve: (result: { data: Row[] | null; error: { message: string } | null }) => unknown) {
          return Promise.resolve({
            data: fail ? null : rows,
            error: fail ? { message: "database unavailable" } : null,
          }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as Parameters<typeof validateMvPaymentStations>[0];
  return { db, calls };
}

const online = (fields: Row = {}) => ({
  id: "online-mv",
  type: "MV_DISTRIBUTION",
  payment_status: "UNPAID",
  ...fields,
});

test("saved online MBC carts are blocked even when other online options are selected", async () => {
  for (const paymentStatus of ["UNPAID", "PAYMENT_PENDING", null]) {
    const fixture = dbFixture([online({
      payment_status: paymentStatus,
      mv_selected_station_codes: ["MNET", " mbc ", "ETN"],
    })]);
    assert.equal(
      await validateMvPaymentStations(fixture.db, ["online-mv"]),
      RETIRED_ONLINE_MBC_PAYMENT_MESSAGE,
    );
  }
});

test("legacy online station review rows block MBC even without selected-code metadata", async () => {
  for (const station of [{ code: "MBC" }, [{ code: "MBC" }]]) {
    const fixture = dbFixture([online({ reviews: [{ station }] })]);
    assert.equal(
      await validateMvPaymentStations(fixture.db, ["online-mv"]),
      RETIRED_ONLINE_MBC_PAYMENT_MESSAGE,
    );
  }
});

test("MNET, ETN, base-only and missing station metadata do not produce false MBC warnings", async () => {
  for (const fields of [
    {},
    { mv_selected_station_codes: null, reviews: null },
    { mv_selected_station_codes: [], reviews: [{ station: null }] },
    { mv_selected_station_codes: ["MNET", "ETN"] },
    { reviews: [{ station: { code: "ETN" } }] },
  ]) {
    const fixture = dbFixture([online(fields)]);
    assert.equal(await validateMvPaymentStations(fixture.db, ["online-mv"]), null);
  }
});

test("broadcast, album, paid history and other cart owners' submissions stay unaffected", async () => {
  const fixture = dbFixture([
    online({ id: "broadcast", type: "MV_BROADCAST", mv_selected_station_codes: ["MBC"] }),
    online({ id: "album", type: "ALBUM", mv_selected_station_codes: ["MBC"] }),
    online({ id: "paid", payment_status: "PAID", mv_selected_station_codes: ["MBC"] }),
    online({ id: "other-cart", mv_selected_station_codes: ["MBC"] }),
  ]);
  assert.equal(await validateMvPaymentStations(fixture.db, ["broadcast", "album", "paid"]), null);
  assert.deepEqual(fixture.calls, ["submissions"], "validation only reads submissions");
});

test("station lookup failures stop checkout without claiming that MBC was selected", async () => {
  const fixture = dbFixture([], true);
  const error = await validateMvPaymentStations(fixture.db, ["online-mv"]);
  assert.match(error ?? "", /방송국 정보를 확인할 수 없습니다/);
  assert.notEqual(error, RETIRED_ONLINE_MBC_PAYMENT_MESSAGE);
  const empty = dbFixture([]);
  assert.equal(await validateMvPaymentStations(empty.db, []), null);
  assert.deepEqual(empty.calls, []);
});

test("card, bank and PayPal block retired stations before payment side effects", () => {
  for (const [file, entry, mutation] of [
    ["src/lib/payments/submission.ts", "export const createSubmissionPaymentOrder", '"begin_submission_payment_order"'],
    ["src/app/api/cart/bank/route.ts", "export async function POST", '"begin_submission_bank_payment"'],
    ["src/lib/payments/paypal.ts", "export const createPayPalOrderForSubmission", "const accessToken = await getAccessToken()"],
  ]) {
    const fullSource = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const source = fullSource.slice(fullSource.indexOf(entry));
    const checkIndex = source.indexOf("await validateMvPaymentStations(");
    const mutationIndex = source.indexOf(mutation);
    assert.ok(checkIndex > 0 && checkIndex < mutationIndex, file);
    assert.ok(source.slice(checkIndex, mutationIndex).includes("if (stationError)"), file);
  }
});
