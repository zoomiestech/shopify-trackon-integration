import { test } from "node:test";
import assert from "node:assert/strict";
import { attachAwbProblem } from "../src/lib/attach-awb.js";

const shipment = { orderId: "1", orderGid: "gid://shopify/Order/1" };

test("a 10 to 15 digit AWB on an unbooked order is accepted", () => {
  assert.equal(attachAwbProblem({ awb: "500664884543", shipment }), null);
  assert.equal(attachAwbProblem({ awb: " 500664884543 ", shipment }), null);
});

test("a malformed AWB is refused", () => {
  for (const awb of ["", "123", "50066488454X", "1234567890123456", undefined]) {
    assert.match(attachAwbProblem({ awb, shipment }), /AWB must be 10 to 15 digits/);
  }
});

test("an order the service has never seen is refused", () => {
  assert.match(attachAwbProblem({ awb: "500664884543", shipment: null }), /No shipment record/);
  assert.match(attachAwbProblem({ awb: "500664884543", shipment: { orderId: "1" } }), /No shipment record/);
});

test("an order that already has an AWB is refused, so one is never overwritten", () => {
  assert.match(
    attachAwbProblem({ awb: "500664884543", shipment: { ...shipment, awb: "100272131666" } }),
    /already has AWB 100272131666/
  );
});

test("a cancelled order is refused", () => {
  assert.match(
    attachAwbProblem({ awb: "500664884543", shipment: { ...shipment, shopifyCancelled: true } }),
    /cancelled/
  );
});
