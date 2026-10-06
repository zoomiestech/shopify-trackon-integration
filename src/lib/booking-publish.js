// Makes a fresh Trackon booking visible in Shopify Admin straight away:
// the AWB and history metafields, and a tag staff can filter the order list
// on. The booking itself is already saved, so failures here are reported to
// the caller, never thrown. The next tracking poll rewrites the metafields.

function errorText(error) {
  return String(error?.message || error);
}

export async function publishBookingToShopify(
  { orderGid, awb, shop, bookedTag, history, removeTags = [] },
  { syncTrackingMetafields, addOrderTags, removeOrderTags }
) {
  const errors = [];

  try {
    await syncTrackingMetafields({
      orderGid,
      status: "AWB_CREATED",
      city: "",
      trackingCode: "",
      awb,
      history,
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

  if (removeTags.length) {
    try {
      await removeOrderTags({ orderGid, tags: removeTags, shop });
    } catch (error) {
      errors.push(`remove tags: ${errorText(error)}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
