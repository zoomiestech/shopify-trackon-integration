// Trackon is booked only for orders that staff tag in Shopify Admin.
// Untagged orders are left alone: no booking, no fulfillment, no record.
// The tag also picks Trackon's TypeOfService: <tag>-air for Air, and
// <tag>-sf or the plain <tag> for Surface. Trackon's live API accepts only
// "Air" or "Surface" (error 506), not the "SF" its booking PDF mentions.

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

export function bookingTags(tag) {
  const plain = normalizeTag(tag);
  return {
    plain,
    sf: `${plain}-sf`,
    air: `${plain}-air`,
  };
}

export function bookingChoice(order, tag) {
  const none = { book: false, typeOfService: null, conflict: false };
  if (!normalizeTag(tag)) return none;

  const tags = bookingTags(tag);
  const air = hasBookingTag(order, tags.air);
  const sf = hasBookingTag(order, tags.sf);
  const plain = hasBookingTag(order, tags.plain);

  if (air && sf) return { book: true, typeOfService: null, conflict: true };
  if (air) return { book: true, typeOfService: "Air", conflict: false };
  if (sf || plain) return { book: true, typeOfService: "Surface", conflict: false };
  return none;
}

// Added by the booking worker when every attempt failed. Staff fix the order
// and remove this tag to retry; until then our own tag edits cannot start
// another round of failing bookings.
export const BOOKING_FAILED_TAG = "trackon-booking-failed";

export function shouldBookOrder({ order, shipment, tag }) {
  return (
    bookingChoice(order, tag).book &&
    !hasBookingTag(order, BOOKING_FAILED_TAG) &&
    !order?.cancelled_at &&
    !shipment?.awb
  );
}

// Filters webhooks before they are stored, so the frequent orders/updated
// events for untagged or already-booked orders never reach the job queue.
export function shouldEnqueueOrderWebhook({ topic, order, shipment, tag }) {
  const t = String(topic || "").toLowerCase();

  if (t === "orders/cancelled") {
    return bookingChoice(order, tag).book || Boolean(shipment);
  }

  if (t === "orders/create" || t === "orders/updated") {
    return shouldBookOrder({ order, shipment, tag });
  }

  return false;
}
