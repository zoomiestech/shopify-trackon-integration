import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingRejectionMessage } from "../src/lib/trackon-response.js";

test("a Status false reply is a rejection with Trackon's own message", () => {
  assert.equal(
    bookingRejectionMessage({
      Message: "Customer Code is empty....!",
      Errors: "Error",
      ErrorCode: 505,
      Status: false,
    }),
    "Trackon rejected booking (505): Customer Code is empty....!"
  );
});

test("a rejection without a message still says what happened", () => {
  assert.equal(
    bookingRejectionMessage({ Status: false }),
    "Trackon rejected booking (no error code): no message"
  );
});

test("successful or unknown replies are not rejections", () => {
  assert.equal(bookingRejectionMessage({ Message: "Docket No. :100272131666", Status: true }), null);
  assert.equal(bookingRejectionMessage("Docket No. : 50005555555"), null);
  assert.equal(bookingRejectionMessage(null), null);
});
