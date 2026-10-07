// The trackon.history metafield: one line per step, so staff can read what
// happened to an order without leaving Shopify. Shopify does not let apps
// write timeline comments, so this is the closest equivalent.
// The entries live on the shipment in MongoDB; the metafield is re-rendered
// from them on every write, so a lost write is repaired on the next one.

import {
  trackingRows,
  rowCode,
  rowStatus,
  rowCity,
  rowKey,
  rowDateTime,
} from "./tracking-rows.js";

const MAX_ENTRIES = 100;
const DEFAULT_LINES = 50;

export const FULFILLED_HISTORY_TEXT =
  "Shopify order fulfilled with the AWB and tracking link. Customer emailed.";

const istFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatIst(iso) {
  return istFormat.format(new Date(iso)).replace(", ", " ");
}

export function historyEntriesFromTracking(tracking) {
  const byKey = new Map();

  for (const row of trackingRows(tracking)) {
    const code = rowCode(row);
    const status = rowStatus(row);
    const at = rowDateTime(row);

    // Scans without a usable time cannot be placed in the history.
    if (!at || (!code && !status)) continue;

    const city = rowCity(row);
    const label = code ? `Trackon ${code}: ${status}` : `Trackon: ${status}`;

    byKey.set(`scan:${rowKey(row)}`, {
      key: `scan:${rowKey(row)}`,
      at,
      text: city ? `${label} (${city})` : label,
    });
  }

  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}

export function mergeHistory(existing = [], incoming = []) {
  const byKey = new Map();

  for (const entry of [...(existing || []), ...(incoming || [])]) {
    if (entry?.key && entry.at && !byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAX_ENTRIES);
}

export function renderHistory(entries = [], maxLines = DEFAULT_LINES) {
  return (entries || [])
    .slice(-maxLines)
    .map((entry) => `${formatIst(entry.at)}  ${entry.text}`)
    .join("\n");
}
