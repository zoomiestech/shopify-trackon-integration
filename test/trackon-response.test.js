import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingRejectionMessage, bookingRejectionError, bookingNoReplyError } from "../src/lib/trackon-response.js";

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

test("a rejection becomes a permanent error, so it is not retried", () => {
  const reply = {
    Message: "Pincode NoServiceable for this Product against :N",
    Errors: "Error",
    ErrorCode: 501,
    Status: false,
  };

  const error = bookingRejectionError(reply);

  assert.ok(error instanceof Error);
  assert.equal(error.message, "Trackon rejected booking (501): Pincode NoServiceable for this Product against :N");
  assert.equal(error.permanent, true);
  assert.equal(error.trackonResponse, reply);
});

test("a successful reply gives no rejection error", () => {
  assert.equal(bookingRejectionError({ Message: "Docket No. :100272131666", Status: true }), null);
});

function networkError(code, message = "network") {
  return Object.assign(new Error(message), { code, isAxiosError: true });
}

test("a timeout means Trackon may have booked: permanent, flagged, with the ref", () => {
  const error = bookingNoReplyError(networkError("ECONNABORTED", "timeout of 15000ms exceeded"), "#8375");

  assert.equal(error.permanent, true);
  assert.equal(error.possiblyBooked, true);
  assert.equal(
    error.message,
    "Trackon did not answer in time (timeout of 15000ms exceeded). It may already be booked: check the Trackon portal for ref #8375"
  );
});

test("a connection lost mid-request is treated the same as a timeout", () => {
  for (const code of ["ETIMEDOUT", "ECONNRESET", "EPIPE"]) {
    assert.equal(bookingNoReplyError(networkError(code), "#1")?.possiblyBooked, true, code);
  }
});

test("failures where nothing reached Trackon, or Trackon answered, are left to retry", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]) {
    assert.equal(bookingNoReplyError(networkError(code), "#1"), null, code);
  }

  const answered = networkError("ECONNABORTED");
  answered.response = { status: 502 };
  assert.equal(bookingNoReplyError(answered, "#1"), null);

  assert.equal(bookingNoReplyError(new Error("plain"), "#1"), null);
});
