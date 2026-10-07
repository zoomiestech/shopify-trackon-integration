import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_JOB_ATTEMPTS, retryPlan, failureSummary } from "../src/lib/job-retry.js";

test("a failing job gets 3 attempts in all", () => {
  assert.equal(MAX_JOB_ATTEMPTS, 3);
});

test("attempts 1 and 2 retry after 1 and 2 minutes", () => {
  assert.deepEqual(retryPlan({ attempts: 1 }), { final: false, delaySeconds: 60 });
  assert.deepEqual(retryPlan({ attempts: 2 }), { final: false, delaySeconds: 120 });
});

test("attempt 3 is final", () => {
  assert.deepEqual(retryPlan({ attempts: 3 }), { final: true, delaySeconds: null });
  assert.deepEqual(retryPlan({ attempts: 7 }), { final: true, delaySeconds: null });
});

test("a permanent error is final on the first attempt", () => {
  assert.deepEqual(retryPlan({ attempts: 1, permanent: true }), { final: true, delaySeconds: null });
});

test("a missing attempt count counts as the first attempt", () => {
  assert.deepEqual(retryPlan({}), { final: false, delaySeconds: 60 });
});

test("a Trackon rejection is reported as Trackon's own answer", () => {
  const error = Object.assign(new Error("Trackon rejected booking (501): Pincode NoServiceable"), {
    permanent: true,
    trackonResponse: { Status: false },
  });
  assert.equal(failureSummary(error, 1), "Trackon rejected booking (501): Pincode NoServiceable");
});

test("a permanent problem found before calling Trackon says it was not attempted", () => {
  const error = Object.assign(new Error("The order has both tags. Keep only one"), { permanent: true });
  assert.equal(failureSummary(error, 1), "Booking not attempted: The order has both tags. Keep only one");
});

test("a retried failure says how many attempts were made", () => {
  assert.equal(failureSummary(new Error("timeout of 15000ms exceeded"), 3), "Booking failed after 3 attempts: timeout of 15000ms exceeded");
});
