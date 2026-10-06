import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrackingMetafields } from "../src/lib/tracking-metafields.js";

const now = "2026-10-05T12:00:00.000Z";

test("blank values are left out, because Shopify rejects them", () => {
  const metafields = buildTrackingMetafields({
    orderGid: "gid://shopify/Order/1",
    status: "AWB_CREATED",
    city: "",
    trackingCode: "",
    awb: "100272131675",
    now,
  });

  assert.deepEqual(
    metafields.map((m) => [m.key, m.value]),
    [
      ["current_status", "AWB_CREATED"],
      ["awb", "100272131675"],
      ["last_synced_at", now],
    ]
  );
});

test("whitespace-only and missing values are left out", () => {
  const metafields = buildTrackingMetafields({
    orderGid: "gid://shopify/Order/1",
    status: "  ",
    city: undefined,
    trackingCode: null,
    awb: "1",
    now,
  });

  assert.deepEqual(metafields.map((m) => m.key), ["awb", "last_synced_at"]);
});

test("every metafield is single line text in the trackon namespace, max 255 chars", () => {
  const metafields = buildTrackingMetafields({
    orderGid: "gid://shopify/Order/1",
    status: "x".repeat(300),
    city: "PUNE",
    trackingCode: "PRSS",
    awb: "1",
    now,
  });

  for (const m of metafields) {
    assert.equal(m.ownerId, "gid://shopify/Order/1");
    assert.equal(m.namespace, "trackon");
    assert.equal(m.type, "single_line_text_field");
  }
  assert.equal(metafields[0].value.length, 255);
  assert.deepEqual(
    metafields.map((m) => m.key),
    ["current_status", "current_city", "tracking_code", "awb", "last_synced_at"]
  );
});

test("history is a multi-line text metafield and is not cut to 255 chars", () => {
  const history = "06/10/2026 13:58  Booked\n".repeat(20).trim();
  const metafields = buildTrackingMetafields({
    orderGid: "gid://shopify/Order/1",
    status: "AWB_CREATED",
    awb: "1",
    history,
    now,
  });

  const field = metafields.find((m) => m.key === "history");
  assert.equal(field.type, "multi_line_text_field");
  assert.equal(field.value, history);
});

test("an empty history is left out like any other blank value", () => {
  const metafields = buildTrackingMetafields({
    orderGid: "gid://shopify/Order/1",
    awb: "1",
    history: "",
    now,
  });
  assert.equal(metafields.some((m) => m.key === "history"), false);
});
