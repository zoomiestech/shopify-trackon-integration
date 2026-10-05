// Trackon is booked only for orders that staff tag in Shopify Admin.
// Untagged orders are left alone: no booking, no fulfillment, no record.

function normalizeTag(value) {
  return String(value || "").trim().toLowerCase();
}

function orderTags(order) {
  const raw = order?.tags;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  return list.map(normalizeTag).filter(Boolean);
}

export function hasBookingTag(order, tag) {
  const wanted = normalizeTag(tag);
  if (!wanted) return false;
  return orderTags(order).includes(wanted);
}

export function shouldBookOrder({ order, shipment, tag }) {
  return (
    hasBookingTag(order, tag) &&
    !order?.cancelled_at &&
    !shipment?.awb
  );
}

// Filters webhooks before they are stored, so the frequent orders/updated
// events for untagged or already-booked orders never reach the job queue.
export function shouldEnqueueOrderWebhook({ topic, order, shipment, tag }) {
  const t = String(topic || "").toLowerCase();

  if (t === "orders/cancelled") {
    return hasBookingTag(order, tag) || Boolean(shipment);
  }

  if (t === "orders/create" || t === "orders/updated") {
    return shouldBookOrder({ order, shipment, tag });
  }

  return false;
}
