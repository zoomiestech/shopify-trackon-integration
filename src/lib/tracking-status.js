// Turns Trackon problem statuses into things staff can see in Shopify:
// tags to filter the order list on, and attempted-delivery events on the
// fulfillment. Codes come from Trackon's tracking API track-code table.

import {
  trackingRows,
  rowCode,
  rowStatus,
  rowKey,
  rowDateTime,
  normalizeCode,
} from "./tracking-rows.js";

export const STATUS_TAGS = {
  pickupFailed: "trackon-pickup-failed",
  deliveryFailed: "trackon-delivery-failed",
  rto: "trackon-rto",
};

const MANAGED_TAGS = new Set(Object.values(STATUS_TAGS));

const PICKUP_FAILED_CODES = new Set(["PRSN"]);

export const DELIVERY_FAILED_CODES = new Set(["DNUB", "DNUF", "DNUA"]);

const RTO_CODES = new Set([
  "RSET",
  "RMFT",
  "RIST",
  "RISR",
  "RITE",
  "RIRE",
  "RHOB",
  "RHOD",
  "RHON",
]);

// Pickup and delivery failures describe the current state, so they clear
// when Trackon moves on. A return, once started, stays.
export function desiredStatusTags(tracking) {
  const latest = normalizeCode(tracking?.trackingCode);
  const tags = [];

  if (PICKUP_FAILED_CODES.has(latest)) {
    tags.push(STATUS_TAGS.pickupFailed);
  }

  if (DELIVERY_FAILED_CODES.has(latest)) {
    tags.push(STATUS_TAGS.deliveryFailed);
  }

  if (trackingRows(tracking).some((row) => RTO_CODES.has(rowCode(row)))) {
    tags.push(STATUS_TAGS.rto);
  }

  return tags;
}

export function statusTagChanges(current = [], desired = []) {
  const have = new Set((current || []).filter((tag) => MANAGED_TAGS.has(tag)));
  const want = new Set(desired);

  return {
    add: [...want].filter((tag) => !have.has(tag)),
    remove: [...have].filter((tag) => !want.has(tag)),
  };
}

export function pendingAttemptedDeliveries(tracking, sentKeys = []) {
  const sent = new Set(sentKeys || []);
  const byKey = new Map();

  for (const row of trackingRows(tracking)) {
    if (!DELIVERY_FAILED_CODES.has(rowCode(row))) continue;

    const key = rowKey(row);
    const happenedAt = rowDateTime(row);
    if (sent.has(key) || !happenedAt) continue;

    byKey.set(key, {
      key,
      happenedAt,
      message: `Delivery attempted: ${rowStatus(row) || "not delivered"}`,
    });
  }

  return [...byKey.values()].sort((a, b) =>
    a.happenedAt.localeCompare(b.happenedAt)
  );
}
