// Makes a fresh Trackon booking visible in Shopify Admin straight away:
// the AWB metafield, and a tag staff can filter the order list on.
// The booking itself is already saved, so failures here are reported to the
// caller, never thrown. The next tracking poll rewrites the metafields.

function errorText(error) {
  return String(error?.message || error);
}

export async function publishBookingToShopify(
  { orderGid, awb, shop, bookedTag },
  { syncTrackingMetafields, addOrderTags }
) {
  const errors = [];

  try {
    await syncTrackingMetafields({
      orderGid,
      status: "AWB_CREATED",
      city: "",
      trackingCode: "",
      awb,
      shop,
    });
  } catch (error) {
    errors.push(`metafields: ${errorText(error)}`);
  }

  if (bookedTag) {
    try {
      await addOrderTags({ orderGid, tags: [bookedTag], shop });
    } catch (error) {
      errors.push(`tag: ${errorText(error)}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
