import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_TAGS,
  desiredStatusTags,
  statusTagChanges,
  pendingAttemptedDeliveries,
} from "../src/lib/tracking-status.js";

function row(code, date = "09/10/2026", time = "18:12:00", status = `STATUS ${code}`) {
  return {
    CURRENT_CITY: "PUNE",
    CURRENT_STATUS: status,
    EVENTDATE: date,
    EVENTTIME: time,
    TRACKING_CODE: code,
  };
}

function tracking(latest, details = []) {
  return {
    status: latest.CURRENT_STATUS,
    city: latest.CURRENT_CITY,
    trackingCode: latest.TRACKING_CODE,
    eventDate: latest.EVENTDATE,
    eventTime: latest.EVENTTIME,
    details,
  };
}

test("a failed pickup as the latest status is tagged", () => {
  assert.deepEqual(desiredStatusTags(tracking(row("PRSN"))), [STATUS_TAGS.pickupFailed]);
});

test("a failed delivery attempt as the latest status is tagged", () => {
  for (const code of ["DNUB", "DNUF", "DNUA"]) {
    assert.deepEqual(desiredStatusTags(tracking(row(code))), [STATUS_TAGS.deliveryFailed]);
  }
});

test("failure tags clear once Trackon moves on", () => {
  const t = tracking(row("PRSS"), [row("PRSN", "07/10/2026")]);
  assert.deepEqual(desiredStatusTags(t), []);
});

test("RTO is tagged from any return code and stays once set", () => {
  assert.deepEqual(desiredStatusTags(tracking(row("RSET"))), [STATUS_TAGS.rto]);
  assert.deepEqual(desiredStatusTags(tracking(row("RHOD"))), [STATUS_TAGS.rto]);

  const heldAfterRto = tracking(row("HELD"), [row("RSET", "08/10/2026")]);
  assert.deepEqual(desiredStatusTags(heldAfterRto), [STATUS_TAGS.rto]);
});

test("statusTagChanges only adds missing tags and removes stale ones", () => {
  assert.deepEqual(
    statusTagChanges([STATUS_TAGS.pickupFailed], [STATUS_TAGS.deliveryFailed]),
    { add: [STATUS_TAGS.deliveryFailed], remove: [STATUS_TAGS.pickupFailed] }
  );
  assert.deepEqual(
    statusTagChanges([STATUS_TAGS.rto], [STATUS_TAGS.rto]),
    { add: [], remove: [] }
  );
  assert.deepEqual(statusTagChanges(undefined, []), { add: [], remove: [] });
});

test("statusTagChanges never removes tags it does not manage", () => {
  assert.deepEqual(statusTagChanges(["vip", "book-trackon"], []), { add: [], remove: [] });
});

test("each failed delivery attempt becomes one attempted-delivery event", () => {
  const first = row("DNUB", "08/10/2026", "17:00:00", "UNDELIVERED DUE TO DOOR LOCKED");
  const second = row("DNUA", "09/10/2026", "18:12:00", "UNDELIVERED DUE TO CUSTOMER NOT AVAILABLE");
  const t = tracking(second, [second, first, row("DRSG", "09/10/2026", "09:00:00")]);

  assert.deepEqual(pendingAttemptedDeliveries(t, []), [
    {
      key: "DNUB|08/10/2026|17:00:00",
      happenedAt: "2026-10-08T11:30:00.000Z",
      message: "Delivery attempted: UNDELIVERED DUE TO DOOR LOCKED",
    },
    {
      key: "DNUA|09/10/2026|18:12:00",
      happenedAt: "2026-10-09T12:42:00.000Z",
      message: "Delivery attempted: UNDELIVERED DUE TO CUSTOMER NOT AVAILABLE",
    },
  ]);
});

test("attempted-delivery events already sent are skipped", () => {
  const attempt = row("DNUB", "08/10/2026", "17:00:00");
  const t = tracking(attempt, [attempt]);
  assert.deepEqual(pendingAttemptedDeliveries(t, ["DNUB|08/10/2026|17:00:00"]), []);
});
