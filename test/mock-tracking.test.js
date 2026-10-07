import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMockScan,
  buildMockTrackingResponse,
} from "../src/lib/mock-tracking.js";
import { rowDateTime, normalizeTrackonTracking } from "../src/lib/tracking-rows.js";

const at = new Date("2026-10-06T09:42:05.000Z"); // 15:12:05 in India

test("a scan is stamped with India date and time, like Trackon", () => {
  assert.deepEqual(buildMockScan({ code: "prss", at }), {
    CURRENT_CITY: "MOCK HUB",
    CURRENT_STATUS: "PICKUP SUCESSFUL",
    EVENTDATE: "06/10/2026",
    EVENTTIME: "15:12:05",
    TRACKING_CODE: "PRSS",
  });
  assert.equal(rowDateTime(buildMockScan({ code: "PRSS", at })), at.toISOString());
});

test("a scan can carry its own reason and city", () => {
  const scan = buildMockScan({
    code: "DNUB",
    status: "UNDELIVERED DUE TO DOOR LOCKED",
    city: "PUNE",
    at,
  });
  assert.equal(scan.CURRENT_STATUS, "UNDELIVERED DUE TO DOOR LOCKED");
  assert.equal(scan.CURRENT_CITY, "PUNE");
});

test("every code in Trackon's track-code table has a default description", () => {
  for (const code of ["PRSN", "DRSG", "DRSF", "DNUA", "DDUB", "RSET", "RHOD", "HELD"]) {
    assert.ok(buildMockScan({ code, at }).CURRENT_STATUS);
  }
});

test("an unknown code is refused, so typos do not pass silently", () => {
  assert.throws(() => buildMockScan({ code: "PRS", at }), /Unknown Trackon tracking code: PRS/);
  assert.throws(() => buildMockScan({ code: "", at }), /Unknown Trackon tracking code/);
});

test("the mock reply has the live shape: summaryTrack null, summary in CustomersummaryTrack", () => {
  const reply = buildMockTrackingResponse("123", []);
  assert.equal(reply.summaryTrack, null);
  assert.ok(reply.CustomersummaryTrack);
});

test("without scans the mock reply is a booked status with no scan time", () => {
  const reply = buildMockTrackingResponse("123", []);
  assert.equal(reply.CustomersummaryTrack.AWBNO, "123");
  assert.equal(reply.CustomersummaryTrack.TRACKING_CODE, "BOKN");
  assert.equal(reply.CustomersummaryTrack.EVENTDATE, "");
  assert.deepEqual(reply.lstDetails, []);
});

test("with scans the latest is the summary and lstDetails is newest first", () => {
  const first = buildMockScan({ code: "PRSS", at: new Date("2026-10-06T05:00:00Z") });
  const second = buildMockScan({ code: "DRSG", at: new Date("2026-10-07T04:00:00Z") });

  const reply = buildMockTrackingResponse("123", [first, second]);

  assert.equal(reply.CustomersummaryTrack.AWBNO, "123");
  assert.equal(reply.CustomersummaryTrack.TRACKING_CODE, "DRSG");
  assert.deepEqual(reply.lstDetails.map((r) => r.TRACKING_CODE), ["DRSG", "PRSS"]);
  assert.equal(reply.ResponseStatus.Message, "SUCCESS");

  const normalized = normalizeTrackonTracking(reply);
  assert.equal(normalized.trackingCode, "DRSG");
  assert.equal(normalized.details.length, 2);
});

// The same chain the tracking worker runs on each poll.
import { desiredStatusTags, pendingAttemptedDeliveries, STATUS_TAGS } from "../src/lib/tracking-status.js";
import { historyEntriesFromTracking } from "../src/lib/trackon-history.js";

function poll(codes) {
  const scans = codes.map((code, i) =>
    buildMockScan({ code, at: new Date(Date.UTC(2026, 9, 6, 5, i)) })
  );
  return normalizeTrackonTracking(buildMockTrackingResponse("123", scans));
}

test("scenario: pickup failed tags the order, pickup success clears it", () => {
  assert.deepEqual(desiredStatusTags(poll(["PRSN"])), [STATUS_TAGS.pickupFailed]);
  assert.deepEqual(desiredStatusTags(poll(["PRSN", "PRSS"])), []);
});

test("scenario: a failed attempt gives one event and a tag, delivery clears the tag", () => {
  const attempt = poll(["PRSS", "DRSG", "DNUB"]);
  assert.deepEqual(desiredStatusTags(attempt), [STATUS_TAGS.deliveryFailed]);
  assert.equal(pendingAttemptedDeliveries(attempt, []).length, 1);

  const delivered = poll(["PRSS", "DRSG", "DNUB", "DRSG", "DDUB"]);
  assert.deepEqual(desiredStatusTags(delivered), []);
  assert.equal(delivered.trackingCode, "DDUB");
});

test("scenario: a return is tagged from RSET through RHOD", () => {
  assert.deepEqual(desiredStatusTags(poll(["PRSS", "RSET"])), [STATUS_TAGS.rto]);
  assert.deepEqual(desiredStatusTags(poll(["PRSS", "RSET", "RHOD"])), [STATUS_TAGS.rto]);
});

test("scenario: every fake scan becomes a history line", () => {
  const entries = historyEntriesFromTracking(poll(["PRSS", "DRSG", "DDUB"]));
  assert.deepEqual(
    entries.map((e) => e.text),
    [
      "Trackon PRSS: PICKUP SUCESSFUL (MOCK HUB)",
      "Trackon DRSG: OUT FOR DELIVERY (MOCK HUB)",
      "Trackon DDUB: DELIVERED (MOCK HUB)",
    ]
  );
});
