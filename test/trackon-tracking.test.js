import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTrackonTracking } from "../src/services/trackon.js";

// Live reply for a freshly booked AWB: summaryTrack is null and the
// current status sits in CustomersummaryTrack.
const liveReply = {
  summaryTrack: null,
  CustomersummaryTrack: {
    AWBNO: null,
    CURRENT_STATUS: "SOFTDATA RECEIVED",
    CURRENT_CITY: "PNQPB-PIMPRI  HUB, MAHARASHTRA",
    EVENTDATE: "06/10/2026",
    EVENTTIME: "13:50:36",
    TRACKING_CODE: "SFDT",
    NDR_REASON: "",
    PODUrl: "",
  },
  lstDetails: [
    {
      CURRENT_CITY: "PNQPB-PIMPRI  HUB, MAHARASHTRA",
      CURRENT_STATUS: "SOFTDATA RECEIVED",
      EVENTDATE: "06/10/2026",
      EVENTTIME: "13:50:36",
      TRACKING_CODE: "SFDT",
    },
  ],
  ResponseStatus: { Message: "SUCCESS" },
};

test("the current status is read from CustomersummaryTrack when summaryTrack is null", () => {
  const tracking = normalizeTrackonTracking(liveReply);

  assert.equal(tracking.status, "SOFTDATA RECEIVED");
  assert.equal(tracking.trackingCode, "SFDT");
  assert.equal(tracking.city, "PNQPB-PIMPRI  HUB, MAHARASHTRA");
  assert.equal(tracking.eventDate, "06/10/2026");
  assert.equal(tracking.eventTime, "13:50:36");
});

test("summaryTrack is still read when Trackon fills it", () => {
  const tracking = normalizeTrackonTracking({
    summaryTrack: { AWBNO: "500664884417", CURRENT_STATUS: "PICKUP SUCCESSFUL", TRACKING_CODE: "PRSS" },
    lstDetails: [],
  });

  assert.equal(tracking.awb, "500664884417");
  assert.equal(tracking.status, "PICKUP SUCCESSFUL");
  assert.equal(tracking.trackingCode, "PRSS");
});
