import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("cart DELETE avoids the PostgREST OR-filter regression", () => {
  const source = read("src/app/api/cart/items/route.ts");
  const handlerStart = source.indexOf("export async function DELETE");
  const handler = source.slice(handlerStart);
  const loadStart = handler.indexOf("let loadQuery = admin");
  const loadEnd = handler.indexOf("const { data, error } = await loadQuery", loadStart);
  const mutationStart = handler.indexOf("let deleteQuery = admin");
  const mutationEnd = handler.indexOf(
    "const { data: deletedRows, error: deleteError }",
    mutationStart,
  );

  assert.ok(handlerStart >= 0, "cart DELETE handler is missing");
  assert.ok(loadStart >= 0 && loadEnd > loadStart, "cart preflight query is missing");
  assert.ok(
    mutationStart >= 0 && mutationEnd > mutationStart,
    "cart delete mutation is missing",
  );

  const loadQuery = handler.slice(loadStart, loadEnd);
  const deleteMutation = handler.slice(mutationStart, mutationEnd);

  // SELECT supports the nullable legacy rows that can still appear in carts.
  assert.match(loadQuery, /\.or\(cartPaymentFilter\)/);

  // PostgREST 14 currently emits an invalid qualified column for this OR on
  // DELETE (SQLSTATE 42703). Keep the mutation on the explicit enum values.
  assert.match(deleteMutation, /\.delete\(\)/);
  assert.match(
    deleteMutation,
    /\.in\("payment_status", \["UNPAID", "PAYMENT_PENDING"\]\)/,
  );
  assert.doesNotMatch(deleteMutation, /\.or\(cartPaymentFilter\)/);
});
