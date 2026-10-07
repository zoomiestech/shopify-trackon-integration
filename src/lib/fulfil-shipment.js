// Fulfils the Shopify order with the Trackon AWB and tracking link, and
// sends the customer Shopify's shipping email. Runs right after booking;
// the tracking poll calls it again for any shipment where it failed.
// Never throws: the AWB already exists, so a Shopify failure must not
// make the booking job retry and book a second AWB.
export async function fulfilShipment(
  shipment,
  {
    createShopifyFulfillment,
    now = () => new Date().toISOString(),
  }
) {
  if (
    !shipment?.awb ||
    !shipment.orderGid ||
    shipment.shopifyFulfillmentId ||
    shipment.shopifyCancelled
  ) {
    return { fulfilled: false, error: null, patch: null };
  }

  try {
    const fulfillment = await createShopifyFulfillment({
      orderGid: shipment.orderGid,
      awb: shipment.awb,
      shop: shipment.shop,
      notifyCustomer: true,
    });

    return {
      fulfilled: true,
      error: null,
      patch: {
        shopifyFulfillmentId: fulfillment.id,
        shopifyFulfillmentStatus: fulfillment.status,
        shopifyFulfillmentCreatedAt: now(),
        dispatchState: "FULFILLED",
        shopifyFulfillmentError: null,
      },
    };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 5000);

    return {
      fulfilled: false,
      error: message,
      patch: {
        shopifyFulfillmentError: message,
        shopifyFulfillmentErrorAt: now(),
      },
    };
  }
}
