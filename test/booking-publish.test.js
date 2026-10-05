import { test } from "node:test";
import assert from "node:assert/strict";
import { publishBookingToShopify } from "../src/lib/booking-publish.js";

const booking = {
  orderGid: "gid://shopify/Order/1",
  awb: "100272131666",
  shop: "test.myshopify.com",
  bookedTag: "trackon-booked",
};

function recorder() {
  const calls = { metafields: [], tags: [] };
  return {
    calls,
    deps: {
      syncTrackingMetafields: async (args) => {
        calls.metafields.push(args);
      },
      addOrderTags: async (args) => {
        calls.tags.push(args);
      },
    },
  };
}

test("writes the AWB metafield and adds the booked tag", async () => {
  const { calls, deps } = recorder();

  const result = await publishBookingToShopify(booking, deps);

  assert.deepEqual(calls.metafields, [
    {
      orderGid: "gid://shopify/Order/1",
      status: "AWB_CREATED",
      city: "",
      trackingCode: "",
      awb: "100272131666",
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
  assert.deepEqual(result, { ok: true, errors: [] });
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

test("a tag failure is reported and never thrown", async () => {
  const { deps } = recorder();
  deps.addOrderTags = async () => {
    throw new Error("tag boom");
  };

  const result = await publishBookingToShopify(booking, deps);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["tag: tag boom"]);
});

test("no tag is added when the booked tag is not configured", async () => {
  const { calls, deps } = recorder();

  const result = await publishBookingToShopify({ ...booking, bookedTag: "" }, deps);

  assert.equal(calls.tags.length, 0);
  assert.equal(calls.metafields.length, 1);
  assert.equal(result.ok, true);
});
