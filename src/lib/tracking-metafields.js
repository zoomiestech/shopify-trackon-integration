// Shopify's metafieldsSet rejects blank values and fails the whole batch,
// so empty fields are left out. Their previous value stays on the order.
export function buildTrackingMetafields({
  orderGid,
  status,
  city,
  trackingCode,
  awb,
  now = new Date().toISOString(),
}) {
  const entries = [
    ["current_status", status],
    ["current_city", city],
    ["tracking_code", trackingCode],
    ["awb", awb],
    ["last_synced_at", now],
  ];

  return entries
    .map(([key, value]) => [key, String(value ?? "").trim()])
    .filter(([, value]) => value)
    .map(([key, value]) => ({
      ownerId: orderGid,
      namespace: "trackon",
      key,
      type: "single_line_text_field",
      value: value.slice(0, 255),
    }));
}
