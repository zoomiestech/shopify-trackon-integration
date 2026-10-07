import { test } from "node:test";
import assert from "node:assert/strict";
import { fulfilShipment } from "../src/lib/fulfil-shipment.js";

const now = "2026-10-07T06:00:00.000Z";

const shipment = {
  orderId: "1",
  orderGid: "gid://shopify/Order/1",
  awb: "100272131666",
  shop: "test.myshopify.com",
};

function deps(result = { id: "gid://shopify/Fulfillment/9", status: "SUCCESS" }) {
  const calls = [];
  return {
    calls,
    deps: {
      createShopifyFulfillment: async (args) => {
        calls.push(args);
        if (result instanceof Error) throw result;
        return result;
      },
      now: () => now,
    },
  };
}

test("fulfils with the AWB and emails the customer", async () => {
  const { calls, deps: d } = deps();

  const result = await fulfilShipment(shipment, d);

  assert.deepEqual(calls, [
    {
      orderGid: "gid://shopify/Order/1",
      awb: "100272131666",
      shop: "test.myshopify.com",
      notifyCustomer: true,
    },
  ]);
  assert.deepEqual(result, {
    fulfilled: true,
    error: null,
    patch: {
      shopifyFulfillmentId: "gid://shopify/Fulfillment/9",
      shopifyFulfillmentStatus: "SUCCESS",
      shopifyFulfillmentCreatedAt: now,
      dispatchState: "FULFILLED",
      shopifyFulfillmentError: null,
    },
  });
});

test("a Shopify failure is reported in the patch, never thrown", async () => {
  const { deps: d } = deps(new Error("No open Shopify fulfillment order found."));

  const result = await fulfilShipment(shipment, d);

  assert.equal(result.fulfilled, false);
  assert.equal(result.error, "No open Shopify fulfillment order found.");
  assert.deepEqual(result.patch, {
    shopifyFulfillmentError: "No open Shopify fulfillment order found.",
    shopifyFulfillmentErrorAt: now,
  });
});

test("nothing is sent when the shipment is already fulfilled, cancelled or has no AWB", async () => {
  for (const s of [
    { ...shipment, shopifyFulfillmentId: "gid://shopify/Fulfillment/1" },
    { ...shipment, shopifyCancelled: true },
    { ...shipment, awb: "" },
    { ...shipment, orderGid: "" },
  ]) {
    const { calls, deps: d } = deps();
    const result = await fulfilShipment(s, d);
    assert.equal(calls.length, 0);
    assert.deepEqual(result, { fulfilled: false, error: null, patch: null });
  }
});
