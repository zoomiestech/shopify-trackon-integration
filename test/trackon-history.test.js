import { test } from "node:test";
import assert from "node:assert/strict";
import {
  historyEntriesFromTracking,
  mergeHistory,
  renderHistory,
} from "../src/lib/trackon-history.js";

const tracking = {
  status: "UNDELIVERED DUE TO CUSTOMER NOT AVAILABLE",
  city: "PUNE",
  trackingCode: "DNUB",
  eventDate: "09/10/2026",
  eventTime: "18:12:00",
  details: [
    {
      CURRENT_CITY: "PUNE",
      CURRENT_STATUS: "UNDELIVERED DUE TO CUSTOMER NOT AVAILABLE",
      EVENTDATE: "09/10/2026",
      EVENTTIME: "18:12:00",
      TRACKING_CODE: "DNUB",
    },
    {
      CURRENT_CITY: "PUNE",
      CURRENT_STATUS: "PICKUP SUCESSFUL",
      EVENTDATE: "07/10/2026",
      EVENTTIME: "11:20:00",
      TRACKING_CODE: "PRSS",
    },
    {
      CURRENT_CITY: "",
      CURRENT_STATUS: "NO DATE",
      EVENTDATE: "",
      EVENTTIME: "",
      TRACKING_CODE: "BOKN",
    },
  ],
};

test("each dated Trackon scan becomes one history entry, oldest first", () => {
  const entries = historyEntriesFromTracking(tracking);

  assert.deepEqual(entries, [
    {
      key: "scan:PRSS|07/10/2026|11:20:00",
      at: "2026-10-07T05:50:00.000Z",
      text: "Trackon PRSS: PICKUP SUCESSFUL (PUNE)",
    },
    {
      key: "scan:DNUB|09/10/2026|18:12:00",
      at: "2026-10-09T12:42:00.000Z",
      text: "Trackon DNUB: UNDELIVERED DUE TO CUSTOMER NOT AVAILABLE (PUNE)",
    },
  ]);
});

test("mergeHistory drops duplicates by key and sorts by time", () => {
  const existing = [
    { key: "booked", at: "2026-10-06T08:28:00.000Z", text: "Booked" },
    { key: "scan:a", at: "2026-10-07T05:50:00.000Z", text: "A" },
  ];
  const incoming = [
    { key: "scan:a", at: "2026-10-07T05:50:00.000Z", text: "A again" },
    { key: "scan:b", at: "2026-10-06T09:00:00.000Z", text: "B" },
  ];

  assert.deepEqual(
    mergeHistory(existing, incoming).map((e) => e.text),
    ["Booked", "B", "A"]
  );
});

test("mergeHistory keeps only the newest 100 entries", () => {
  const many = Array.from({ length: 120 }, (_, i) => ({
    key: `k${i}`,
    at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    text: `line ${i}`,
  }));

  const merged = mergeHistory([], many);
  assert.equal(merged.length, 100);
  assert.equal(merged[0].text, "line 20");
  assert.equal(merged[99].text, "line 119");
});

test("mergeHistory tolerates missing input", () => {
  assert.deepEqual(mergeHistory(undefined, undefined), []);
});

test("renderHistory prints one India-time line per entry, newest last", () => {
  const text = renderHistory([
    { key: "booked", at: "2026-10-06T08:28:00.000Z", text: "Booked with Trackon. AWB 1" },
    { key: "scan:a", at: "2026-10-07T05:50:00.000Z", text: "Trackon PRSS: PICKUP SUCESSFUL" },
  ]);

  assert.equal(
    text,
    "06/10/2026 13:58  Booked with Trackon. AWB 1\n" +
      "07/10/2026 11:20  Trackon PRSS: PICKUP SUCESSFUL"
  );
});

test("renderHistory shows only the newest lines when asked", () => {
  const entries = [
    { key: "a", at: "2026-10-06T08:28:00.000Z", text: "first" },
    { key: "b", at: "2026-10-07T08:28:00.000Z", text: "second" },
  ];
  assert.equal(renderHistory(entries, 1), "07/10/2026 13:58  second");
  assert.equal(renderHistory([]), "");
});
