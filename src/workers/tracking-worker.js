import { config } from "../config.js";

import {
  listShipments,
  upsertShipment,
} from "../lib/store.js";

import {
  trackTrackonAwb,
  normalizeTrackonTracking,
} from "../services/trackon.js";

import {
  syncTrackingMetafields,
  createShopifyFulfillmentEvent,
} from "../services/shopify.js";

let running = false;

const OUT_FOR_DELIVERY_CODES =
  new Set([
    "DRSG",
    "DRSF",
  ]);

const DELIVERED_CODES =
  new Set([
    "DDUB",
    "DDUF",
    "DDUA",
  ]);

const TERMINAL_CODES =
  new Set([
    ...DELIVERED_CODES,

    // RTO delivered. Terminal for polling, but this does NOT
    // send the forward-order Shopify "Delivered" event.
    "RHOD",
  ]);

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

function isTerminal(shipment) {
  const code = normalizeCode(
    shipment.trackingCode
  );

  if (TERMINAL_CODES.has(code)) {
    return true;
  }

  const status = String(
    shipment.trackingStatus || ""
  ).toLowerCase();

  return (
    status.includes("delivered") &&
    !status.includes("undelivered")
  );
}

function needsShopifyMilestoneEvent(
  shipment
) {
  const code = normalizeCode(
    shipment.trackingCode
  );

  if (
    OUT_FOR_DELIVERY_CODES.has(code) &&
    !shipment.shopifyOutForDeliverySentAt
  ) {
    return true;
  }

  if (
    DELIVERED_CODES.has(code) &&
    !shipment.shopifyDeliveredSentAt
  ) {
    return true;
  }

  return false;
}

function buildHappenedAt(
  eventDate,
  eventTime
) {
  if (!eventDate) {
    return undefined;
  }

  const rawDate =
    String(eventDate).trim();

  const rawTime =
    String(eventTime || "00:00:00").trim();

  const match =
    rawDate.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

  if (match) {
    const [, dd, mm, yyyy] =
      match;

    const iso =
      `${yyyy}-` +
      `${mm.padStart(2, "0")}-` +
      `${dd.padStart(2, "0")}T` +
      `${rawTime || "00:00:00"}` +
      "+05:30";

    const date = new Date(iso);

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return date.toISOString();
    }
  }

  const fallback =
    new Date(
      `${rawDate} ${rawTime}`
    );

  if (
    !Number.isNaN(
      fallback.getTime()
    )
  ) {
    return fallback.toISOString();
  }

  return undefined;
}

function getShopifyMilestone(
  tracking
) {
  const code = normalizeCode(
    tracking.trackingCode
  );

  if (
    OUT_FOR_DELIVERY_CODES.has(code)
  ) {
    return {
      status:
        "OUT_FOR_DELIVERY",

      message:
        tracking.city
          ? `Your shipment is out for delivery from ${tracking.city}.`
          : "Your shipment is out for delivery.",

      sentAtField:
        "shopifyOutForDeliverySentAt",

      eventIdField:
        "shopifyOutForDeliveryEventId",
    };
  }

  if (
    DELIVERED_CODES.has(code)
  ) {
    return {
      status:
        "DELIVERED",

      message:
        "Your shipment has been delivered.",

      sentAtField:
        "shopifyDeliveredSentAt",

      eventIdField:
        "shopifyDeliveredEventId",
    };
  }

  return null;
}

async function syncShopifyMilestoneEvent(
  shipment,
  tracking
) {
  const milestone =
    getShopifyMilestone(
      tracking
    );

  if (!milestone) {
    return null;
  }

  if (!shipment.shopifyFulfillmentId) {
    return null;
  }

  if (
    shipment[milestone.sentAtField]
  ) {
    return null;
  }

  try {
    const event =
      await createShopifyFulfillmentEvent({
        fulfillmentId:
          shipment.shopifyFulfillmentId,

        status:
          milestone.status,

        message:
          milestone.message,

        happenedAt:
          buildHappenedAt(
            tracking.eventDate,
            tracking.eventTime
          ),

        shop:
          shipment.shop ||
          config.shopify.shop,
      });

    await upsertShipment(
      shipment.orderId,
      {
        [milestone.sentAtField]:
          new Date().toISOString(),

        [milestone.eventIdField]:
          event.id,

        shopifyFulfillmentEventError:
          null,
      }
    );

    console.log(
      `[tracking] Shopify ${milestone.status} event created for order ${shipment.orderId}`
    );

    return event;
  } catch (error) {
    const message =
      String(
        error?.response?.data
          ? JSON.stringify(
              error.response.data
            )
          : error?.message || error
      ).slice(0, 5000);

    await upsertShipment(
      shipment.orderId,
      {
        shopifyFulfillmentEventError:
          message,

        shopifyFulfillmentEventErrorAt:
          new Date().toISOString(),
      }
    );

    console.error(
      `[tracking] Shopify fulfillment event failed for order ${shipment.orderId}`,
      error?.response?.data || error
    );

    return null;
  }
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

export async function runTrackingSyncOnce() {
  if (running) {
    return {
      skipped: true,
      reason: "already running",
    };
  }

  running = true;
  const results = [];

  try {
    const allShipments =
      await listShipments();

    const shipments =
      allShipments.filter(
        (shipment) =>
          shipment.awb &&
          !shipment.shopifyCancelled &&
          (
            !isTerminal(shipment) ||
            needsShopifyMilestoneEvent(
              shipment
            )
          )
      );

    for (const shipment of shipments) {
      try {
        const raw =
          await trackTrackonAwb(
            shipment.awb
          );

        const normalized =
          normalizeTrackonTracking(
            raw
          );

        await upsertShipment(
          shipment.orderId,
          {
            trackingStatus:
              normalized.status,

            trackingCode:
              normalized.trackingCode,

            currentCity:
              normalized.city,

            eventDate:
              normalized.eventDate,

            eventTime:
              normalized.eventTime,

            ndrReason:
              normalized.ndrReason,

            trackingDetails:
              normalized.details,

            trackonTrackingResponse:
              raw,

            lastTrackingSyncAt:
              new Date().toISOString(),

            lastTrackingError:
              null,
          }
        );

        await syncShopifyMilestoneEvent(
          shipment,
          normalized
        );

        if (
          shipment.orderGid &&
          config.shopify.syncTrackingMetafields
        ) {
          try {
            await syncTrackingMetafields({
              orderGid:
                shipment.orderGid,

              status:
                normalized.status,

              city:
                normalized.city,

              trackingCode:
                normalized.trackingCode,

              awb:
                shipment.awb,

              shop:
                shipment.shop ||
                config.shopify.shop,
            });
          } catch (metaError) {
            await upsertShipment(
              shipment.orderId,
              {
                shopifyMetafieldSyncError:
                  String(
                    metaError?.message ||
                    metaError
                  ).slice(0, 2000),
              }
            );
          }
        }

        results.push({
          orderId:
            shipment.orderId,

          awb:
            shipment.awb,

          ok: true,

          status:
            normalized.status,

          trackingCode:
            normalized.trackingCode,
        });
      } catch (error) {
        await upsertShipment(
          shipment.orderId,
          {
            lastTrackingError:
              String(
                error?.response?.data
                  ? JSON.stringify(
                      error.response.data
                    )
                  : error?.message ||
                    error
              ).slice(0, 5000),

            lastTrackingSyncAt:
              new Date().toISOString(),
          }
        );

        results.push({
          orderId:
            shipment.orderId,

          awb:
            shipment.awb,

          ok: false,

          error:
            String(
              error?.message ||
              error
            ),
        });
      }

      if (!config.trackon.mock) {
        await sleep(400);
      }
    }

    return {
      skipped: false,
      count: results.length,
      results,
    };
  } finally {
    running = false;
  }
}

export function startTrackingWorker() {
  const minutes =
    Math.max(
      5,
      config.trackon.pollMinutes
    );

  setInterval(() => {
    runTrackingSyncOnce().catch(
      (err) =>
        console.error(
          "tracking worker loop error",
          err
        )
    );
  }, minutes * 60 * 1000).unref();
}
