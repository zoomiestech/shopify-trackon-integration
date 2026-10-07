import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasBookingTag,
  shouldEnqueueOrderWebhook,
  shouldBookOrder,
  bookingChoice,
  bookingTags,
} from "../src/lib/booking-tag.js";

const TAG = "book-trackon";

test("hasBookingTag matches the tag in Shopify's comma-separated tags string", () => {
  assert.equal(hasBookingTag({ tags: "vip, book-trackon, gift" }, TAG), true);
});

test("hasBookingTag ignores case and surrounding spaces", () => {
  assert.equal(hasBookingTag({ tags: "  Book-Trackon " }, TAG), true);
});

test("hasBookingTag accepts an array of tags", () => {
  assert.equal(hasBookingTag({ tags: ["vip", "BOOK-TRACKON"] }, TAG), true);
});

test("hasBookingTag does not match a tag that only contains the name", () => {
  assert.equal(hasBookingTag({ tags: "book-trackon-later, no-book-trackon" }, TAG), false);
});

test("hasBookingTag is false when tags are missing or empty", () => {
  assert.equal(hasBookingTag({}, TAG), false);
  assert.equal(hasBookingTag({ tags: "" }, TAG), false);
  assert.equal(hasBookingTag(null, TAG), false);
});

test("hasBookingTag is false when no tag is configured", () => {
  assert.equal(hasBookingTag({ tags: "book-trackon" }, ""), false);
});

test("create and update webhooks for a tagged, unbooked order are enqueued", () => {
  const order = { tags: "book-trackon" };
  assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/create", order, shipment: null, tag: TAG }), true);
  assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/updated", order, shipment: null, tag: TAG }), true);
});

test("untagged create and update webhooks are not enqueued", () => {
  const order = { tags: "vip" };
  assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/create", order, shipment: null, tag: TAG }), false);
  assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/updated", order, shipment: null, tag: TAG }), false);
});

test("updates for an order that already has an AWB are not enqueued", () => {
  const order = { tags: "book-trackon" };
  const shipment = { awb: "123456789012" };
  assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/updated", order, shipment, tag: TAG }), false);
});

test("updates for a cancelled order are not enqueued as bookings", () => {
  const order = { tags: "book-trackon", cancelled_at: "2026-10-05T10:00:00Z" };
  assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/updated", order, shipment: null, tag: TAG }), false);
});

test("orders/paid is ignored, even when tagged", () => {
  const order = { tags: "book-trackon" };
  assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/paid", order, shipment: null, tag: TAG }), false);
});

test("cancellations are enqueued for tagged orders or orders we already track", () => {
  assert.equal(
    shouldEnqueueOrderWebhook({ topic: "orders/cancelled", order: { tags: "book-trackon" }, shipment: null, tag: TAG }),
    true
  );
  assert.equal(
    shouldEnqueueOrderWebhook({ topic: "orders/cancelled", order: { tags: "" }, shipment: { awb: "1" }, tag: TAG }),
    true
  );
});

test("cancellations for untagged orders we never tracked are not enqueued", () => {
  assert.equal(
    shouldEnqueueOrderWebhook({ topic: "orders/cancelled", order: { tags: "" }, shipment: null, tag: TAG }),
    false
  );
});

test("topic matching ignores case", () => {
  assert.equal(
    shouldEnqueueOrderWebhook({ topic: "ORDERS/UPDATED", order: { tags: "book-trackon" }, shipment: null, tag: TAG }),
    true
  );
});

test("shouldBookOrder needs the tag, an open order and no existing AWB", () => {
  const order = { tags: "book-trackon" };
  assert.equal(shouldBookOrder({ order, shipment: null, tag: TAG }), true);
  assert.equal(shouldBookOrder({ order, shipment: { awb: "" }, tag: TAG }), true);
  assert.equal(shouldBookOrder({ order: { tags: "" }, shipment: null, tag: TAG }), false);
  assert.equal(shouldBookOrder({ order, shipment: { awb: "123456789012" }, tag: TAG }), false);
  assert.equal(
    shouldBookOrder({ order: { ...order, cancelled_at: "2026-10-05T10:00:00Z" }, shipment: null, tag: TAG }),
    false
  );
});

test("an order tagged trackon-booking-failed is not booked until staff remove that tag", () => {
  const order = { tags: "book-trackon, trackon-booking-failed" };
  assert.equal(shouldBookOrder({ order, shipment: null, tag: TAG }), false);
  assert.equal(
    shouldEnqueueOrderWebhook({ topic: "orders/updated", order, shipment: null, tag: TAG }),
    false
  );
});

test("bookingTags lists the plain, SF and Air tags", () => {
  assert.deepEqual(bookingTags(TAG), {
    plain: "book-trackon",
    sf: "book-trackon-sf",
    air: "book-trackon-air",
  });
});

test("the plain tag and the SF tag book as Surface, the value Trackon accepts", () => {
  assert.deepEqual(bookingChoice({ tags: "book-trackon" }, TAG), { book: true, typeOfService: "Surface", conflict: false });
  assert.deepEqual(bookingChoice({ tags: "Book-Trackon-SF" }, TAG), { book: true, typeOfService: "Surface", conflict: false });
});

test("the Air tag books by air, even next to the plain tag", () => {
  assert.deepEqual(bookingChoice({ tags: "book-trackon-air" }, TAG), { book: true, typeOfService: "Air", conflict: false });
  assert.deepEqual(bookingChoice({ tags: "book-trackon, book-trackon-air" }, TAG), { book: true, typeOfService: "Air", conflict: false });
});

test("both the Air and SF tags is a conflict", () => {
  assert.deepEqual(bookingChoice({ tags: "book-trackon-air, book-trackon-sf" }, TAG), { book: true, typeOfService: null, conflict: true });
});

test("no booking tag means no booking", () => {
  assert.deepEqual(bookingChoice({ tags: "vip, book-trackon-later" }, TAG), { book: false, typeOfService: null, conflict: false });
  assert.deepEqual(bookingChoice({ tags: "book-trackon-air" }, ""), { book: false, typeOfService: null, conflict: false });
});

test("the Air and SF tags trigger booking and webhooks like the plain tag", () => {
  for (const tags of ["book-trackon-air", "book-trackon-sf", "book-trackon-air, book-trackon-sf"]) {
    const order = { tags };
    assert.equal(shouldBookOrder({ order, shipment: null, tag: TAG }), true);
    assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/updated", order, shipment: null, tag: TAG }), true);
    assert.equal(shouldEnqueueOrderWebhook({ topic: "orders/cancelled", order, shipment: null, tag: TAG }), true);
  }
});
