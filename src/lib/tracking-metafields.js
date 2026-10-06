const SINGLE_LINE_MAX = 255;
const MULTI_LINE_MAX = 60000;

// Shopify's metafieldsSet rejects blank values and fails the whole batch,
// so empty fields are left out. Their previous value stays on the order.
export function buildTrackingMetafields({
  orderGid,
  status,
  city,
  trackingCode,
  awb,
  history,
  now = new Date().toISOString(),
}) {
  const entries = [
    ["current_status", status, "single_line_text_field"],
    ["current_city", city, "single_line_text_field"],
    ["tracking_code", trackingCode, "single_line_text_field"],
    ["awb", awb, "single_line_text_field"],
    ["last_synced_at", now, "single_line_text_field"],
    ["history", history, "multi_line_text_field"],
  ];

  return entries
    .map(([key, value, type]) => [key, String(value ?? "").trim(), type])
    .filter(([, value]) => value)
    .map(([key, value, type]) => ({
      ownerId: orderGid,
      namespace: "trackon",
      key,
      type,
      value: value.slice(
        0,
        type === "multi_line_text_field" ? MULTI_LINE_MAX : SINGLE_LINE_MAX
      ),
    }));
}
