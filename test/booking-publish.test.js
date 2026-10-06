import { test } from "node:test";
import assert from "node:assert/strict";
import { publishBookingToShopify } from "../src/lib/booking-publish.js";

const booking = {
  orderGid: "gid://shopify/Order/1",
  awb: "100272131666",
  shop: "test.myshopify.com",
  bookedTag: "trackon-booked",
  history: "06/10/2026 13:58  Booked with Trackon. AWB 100272131666",
};

function recorder() {
  const calls = { metafields: [], tags: [], removed: [] };
  return {
    calls,
    deps: {
      syncTrackingMetafields: async (args) => {
        calls.metafields.push(args);
      },
      addOrderTags: async (args) => {
        calls.tags.push(args);
      },
      removeOrderTags: async (args) => {
        calls.removed.push(args);
      },
    },
  };
}

test("writes the AWB and history metafields and adds the booked tag", async () => {
  const { calls, deps } = recorder();

  const result = await publishBookingToShopify(booking, deps);

  assert.deepEqual(calls.metafields, [
    {
      orderGid: "gid://shopify/Order/1",
      status: "AWB_CREATED",
      city: "",
      trackingCode: "",
      awb: "100272131666",
      history: "06/10/2026 13:58  Booked with Trackon. AWB 100272131666",
      shop: "test.myshopify.com",
    },
  ]);
  assert.deepEqual(calls.tags, [
    {
      orderGid: "gid://shopify/Order/1",
      tags: ["trackon-booked"],
      shop: "test.myshopify.com",
    },
  ]);
  assert.deepEqual(calls.removed, []);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("removes tags it is asked to remove, such as an earlier booking failure", async () => {
  const { calls, deps } = recorder();

  await publishBookingToShopify({ ...booking, removeTags: ["trackon-booking-failed"] }, deps);

  assert.deepEqual(calls.removed, [
    {
      orderGid: "gid://shopify/Order/1",
      tags: ["trackon-booking-failed"],
      shop: "test.myshopify.com",
    },
  ]);
});

test("a metafield failure does not stop the tag, and is reported", async () => {
  const { calls, deps } = recorder();
  deps.syncTrackingMetafields = async () => {
    throw new Error("metafield boom");
  };

  const result = await publishBookingToShopify(booking, deps);

  assert.equal(calls.tags.length, 1);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["metafields: metafield boom"]);
});

test("tag failures are reported and never thrown", async () => {
  const { deps } = recorder();
  deps.addOrderTags = async () => {
    throw new Error("tag boom");
  };
  deps.removeOrderTags = async () => {
    throw new Error("remove boom");
  };

  const result = await publishBookingToShopify(
    { ...booking, removeTags: ["trackon-booking-failed"] },
    deps
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["tag: tag boom", "remove tags: remove boom"]);
});

test("no tag is added when the booked tag is not configured", async () => {
  const { calls, deps } = recorder();

  const result = await publishBookingToShopify({ ...booking, bookedTag: "" }, deps);

  assert.equal(calls.tags.length, 0);
  assert.equal(calls.metafields.length, 1);
  assert.equal(result.ok, true);
});
