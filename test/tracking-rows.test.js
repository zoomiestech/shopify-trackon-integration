import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trackingRows,
  rowCode,
  rowKey,
  rowDateTime,
  trackonEventTime,
} from "../src/lib/tracking-rows.js";

const tracking = {
  status: "OUT FOR DELIVERY",
  city: "PUNE",
  trackingCode: "drsg",
  eventDate: "08/10/2026",
  eventTime: "10:05",
  details: [
    {
      CURRENT_CITY: "PUNE",
      CURRENT_STATUS: "PICKUP SUCESSFUL",
      EVENTDATE: "07/10/2026",
      EVENTTIME: "11:20:00",
      TRACKING_CODE: "PRSS",
    },
  ],
};

test("trackingRows returns the summary first, then the history rows", () => {
  const rows = trackingRows(tracking);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].CURRENT_STATUS, "OUT FOR DELIVERY");
  assert.equal(rows[1].TRACKING_CODE, "PRSS");
  assert.deepEqual(trackingRows(null), []);
});

test("rowCode is upper-cased and trimmed", () => {
  assert.equal(rowCode({ TRACKING_CODE: " drsg " }), "DRSG");
  assert.equal(rowCode({}), "");
});

test("rowKey identifies one scan by code, date and time", () => {
  assert.equal(rowKey(tracking.details[0]), "PRSS|07/10/2026|11:20:00");
});

test("trackonEventTime reads Trackon's dd/mm/yyyy as India time", () => {
  assert.equal(trackonEventTime("07/10/2026", "11:20:00"), "2026-10-07T05:50:00.000Z");
  assert.equal(trackonEventTime("7/10/2026", "11:20"), "2026-10-07T05:50:00.000Z");
});

test("trackonEventTime returns undefined without a usable date", () => {
  assert.equal(trackonEventTime("", "11:20"), undefined);
  assert.equal(trackonEventTime("not a date", ""), undefined);
});

test("rowDateTime uses the row's own date and time", () => {
  assert.equal(rowDateTime(tracking.details[0]), "2026-10-07T05:50:00.000Z");
  assert.equal(rowDateTime(null), undefined);
});
