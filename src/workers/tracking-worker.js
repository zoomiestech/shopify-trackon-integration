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
  addOrderTags,
  removeOrderTags,
  createShopifyFulfillment,
  createShopifyFulfillmentEvent,
  syncTrackingMetafields,
} from "../services/shopify.js";

import {
  normalizeCode,
  trackingRows,
  rowCode,
  rowDateTime,
} from "../lib/tracking-rows.js";

import {
  historyEntriesFromTracking,
  mergeHistory,
  renderHistory,
} from "../lib/trackon-history.js";

import {
  desiredStatusTags,
  statusTagChanges,
  pendingAttemptedDeliveries,
} from "../lib/tracking-status.js";

let running = false;

/**
 * Trackon status mapping used in this integration.
 *
 * PRSS = Pickup Closure - Successful / Pickup Successful
 *
 * DRSG / DRSF = Out for Delivery
 *
 * DDUB / DDUF / DDUA = Delivered
 */
const PICKUP_SUCCESS_CODES =
  new Set([
    "PRSS",
  ]);

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

const RTO_TERMINAL_CODES =
  new Set([
    "RHOD",
  ]);

function findTrackingRowByCodes(
  tracking,
  codes
) {
  return trackingRows(
    tracking
  ).find((row) =>
    codes.has(rowCode(row))
  );
}

function isRtoTerminal(shipment) {
  return RTO_TERMINAL_CODES.has(
    normalizeCode(
      shipment.trackingCode
    )
  );
}

function isForwardDelivered(
  shipment
) {
  return DELIVERED_CODES.has(
    normalizeCode(
      shipment.trackingCode
    )
  );
}

/**
 * We keep polling until the forward shipment has reached Delivered AND
 * the Shopify Delivered event has been successfully created.
 *
 * This prevents a transient Shopify API failure from permanently losing
 * the customer notification.
 */
function shouldPollShipment(
  shipment
) {
  if (
    !shipment.awb ||
    shipment.shopifyCancelled
  ) {
    return false;
  }

  if (
    isRtoTerminal(shipment)
  ) {
    return false;
  }

  if (
    isForwardDelivered(
      shipment
    ) &&
    shipment.shopifyDeliveredSentAt
  ) {
    return false;
  }

  return true;
}

/**
 * Creates the Shopify fulfillment ONLY after Trackon confirms pickup success.
 *
 * This is the dispatch point for the Shopify customer journey.
 */
async function ensureFulfillmentAfterPickup(
  shipment,
  tracking
) {
  if (
    shipment.shopifyFulfillmentId
  ) {
    return shipment;
  }

  const pickupRow =
    findTrackingRowByCodes(
      tracking,
      PICKUP_SUCCESS_CODES
    );

  if (!pickupRow) {
    return shipment;
  }

  if (
    !shipment.orderGid
  ) {
    throw new Error(
      `Cannot create Shopify fulfillment for order ${shipment.orderId}: orderGid is missing.`
    );
  }

  const fulfillment =
    await createShopifyFulfillment({
      orderGid:
        shipment.orderGid,

      awb:
        shipment.awb,

      shop:
        shipment.shop ||
        config.shopify.shop,

      // This is intentionally TRUE here.
      // The customer receives the Shopify dispatch/shipping email
      // only after Trackon PRSS confirms pickup success.
      notifyCustomer:
        true,
    });

  const now =
    new Date().toISOString();

  const pickupAt =
    rowDateTime(
      pickupRow
    ) || now;

  const patch = {
    shopifyFulfillmentId:
      fulfillment.id,

    shopifyFulfillmentStatus:
      fulfillment.status,

    shopifyFulfillmentCreatedAt:
      now,

    pickupConfirmedAt:
      pickupAt,

    pickupTrackingCode:
      normalizeCode(
        pickupRow.TRACKING_CODE ||
        pickupRow.TrackingCode ||
        pickupRow.trackingCode
      ),

    dispatchState:
      "DISPATCHED_AFTER_PICKUP",

    dispatchNotificationRequestedAt:
      now,

    shopifyFulfillmentError:
      null,

    lastError:
      null,
  };

  await upsertShipment(
    shipment.orderId,
    patch
  );

  console.log(
    `[tracking] Pickup confirmed; Shopify fulfillment created for order ${shipment.orderId}`
  );

  return {
    ...shipment,
    ...patch,
  };
}

async function createMilestoneEventOnce({
  shipment,
  tracking,
  codes,
  status,
  message,
  sentAtField,
  eventIdField,
}) {
  if (
    !shipment.shopifyFulfillmentId
  ) {
    return shipment;
  }

  if (
    shipment[sentAtField]
  ) {
    return shipment;
  }

  const row =
    findTrackingRowByCodes(
      tracking,
      codes
    );

  if (!row) {
    return shipment;
  }

  try {
    const event =
      await createShopifyFulfillmentEvent({
        fulfillmentId:
          shipment.shopifyFulfillmentId,

        status,

        message:
          typeof message ===
          "function"
            ? message(row)
            : message,

        happenedAt:
          rowDateTime(row),

        shop:
          shipment.shop ||
          config.shopify.shop,
      });

    const patch = {
      [sentAtField]:
        new Date().toISOString(),

      [eventIdField]:
        event.id,

      shopifyFulfillmentEventError:
        null,
    };

    await upsertShipment(
      shipment.orderId,
      patch
    );

    console.log(
      `[tracking] Shopify ${status} event created for order ${shipment.orderId}`
    );

    return {
      ...shipment,
      ...patch,
    };
  } catch (error) {
    const errorMessage =
      String(
        error?.response?.data
          ? JSON.stringify(
              error.response.data
            )
          : error?.message ||
            error
      ).slice(
        0,
        5000
      );

    await upsertShipment(
      shipment.orderId,
      {
        shopifyFulfillmentEventError:
          errorMessage,

        shopifyFulfillmentEventErrorAt:
          new Date().toISOString(),
      }
    );

    console.error(
      `[tracking] Shopify ${status} event failed for order ${shipment.orderId}`,
      error?.response?.data ||
      error
    );

    // Keep the sentAt marker unset so the next poll retries.
    return shipment;
  }
}

/**
 * One Shopify ATTEMPTED_DELIVERY event per failed delivery attempt
 * (DNUB / DNUF / DNUA), with Trackon's reason. Each attempt is sent once;
 * a failed send is retried on the next poll.
 */
async function sendAttemptedDeliveries(
  shipment,
  tracking
) {
  let sentKeys =
    shipment.shopifyAttemptedDeliveryKeys ||
    [];

  for (
    const attempt of pendingAttemptedDeliveries(
      tracking,
      sentKeys
    )
  ) {
    try {
      await createShopifyFulfillmentEvent({
        fulfillmentId:
          shipment.shopifyFulfillmentId,
        status:
          "ATTEMPTED_DELIVERY",
        message:
          attempt.message,
        happenedAt:
          attempt.happenedAt,
        shop:
          shipment.shop ||
          config.shopify.shop,
      });

      sentKeys = [
        ...sentKeys,
        attempt.key,
      ];

      await upsertShipment(
        shipment.orderId,
        {
          shopifyAttemptedDeliveryKeys:
            sentKeys,
        }
      );

      console.log(
        `[tracking] Shopify ATTEMPTED_DELIVERY event created for order ${shipment.orderId}`
      );
    } catch (error) {
      console.error(
        `[tracking] Shopify ATTEMPTED_DELIVERY event failed for order ${shipment.orderId}`,
        error?.response?.data ||
        error
      );

      await upsertShipment(
        shipment.orderId,
        {
          shopifyFulfillmentEventError:
            String(
              error?.message ||
              error
            ).slice(0, 5000),
          shopifyFulfillmentEventErrorAt:
            new Date().toISOString(),
        }
      );

      break;
    }
  }

  return {
    ...shipment,
    shopifyAttemptedDeliveryKeys:
      sentKeys,
  };
}

/**
 * Keeps the trackon-pickup-failed / trackon-delivery-failed / trackon-rto
 * tags in step with Trackon. Only tags we added are ever removed.
 */
async function syncStatusTags(
  shipment,
  tracking
) {
  if (!shipment.orderGid) {
    return shipment;
  }

  const desired =
    desiredStatusTags(tracking);

  const { add, remove } =
    statusTagChanges(
      shipment.statusTags,
      desired
    );

  if (
    !add.length &&
    !remove.length
  ) {
    return shipment;
  }

  const shop =
    shipment.shop ||
    config.shopify.shop;

  try {
    if (add.length) {
      await addOrderTags({
        orderGid:
          shipment.orderGid,
        tags: add,
        shop,
      });
    }

    if (remove.length) {
      await removeOrderTags({
        orderGid:
          shipment.orderGid,
        tags: remove,
        shop,
      });
    }

    await upsertShipment(
      shipment.orderId,
      {
        statusTags:
          desired,
        shopifyStatusTagError:
          null,
      }
    );

    return {
      ...shipment,
      statusTags:
        desired,
    };
  } catch (error) {
    console.error(
      `[tracking] Shopify status tag update failed for order ${shipment.orderId}`,
      error?.response?.data ||
      error
    );

    await upsertShipment(
      shipment.orderId,
      {
        shopifyStatusTagError:
          String(
            error?.message ||
            error
          ).slice(0, 2000),
      }
    );

    return shipment;
  }
}

/**
 * Adds every Trackon scan, plus our own steps, to the shipment's history.
 * Older shipments booked before history existed get their booking line too.
 */
async function updateHistory(
  shipment,
  tracking
) {
  const ours = [];

  if (shipment.bookingCreatedAt) {
    ours.push({
      key: "booked",
      at: shipment.bookingCreatedAt,
      text: `Booked with Trackon. AWB ${shipment.awb}. Waiting for pickup.`,
    });
  }

  if (shipment.shopifyFulfillmentCreatedAt) {
    ours.push({
      key: "fulfilled",
      at: shipment.shopifyFulfillmentCreatedAt,
      text: "Pickup confirmed. Shopify order fulfilled and the customer emailed.",
    });
  }

  const history =
    mergeHistory(
      shipment.history,
      [
        ...ours,
        ...historyEntriesFromTracking(
          tracking
        ),
      ]
    );

  await upsertShipment(
    shipment.orderId,
    { history }
  );

  return {
    ...shipment,
    history,
  };
}

async function syncShopifyMilestones(
  shipment,
  tracking
) {
  let current =
    shipment;

  /**
   * First create the actual Shopify fulfillment only after PRSS.
   *
   * We inspect both the current summary AND lstDetails.
   * This matters if polling sees a later status but the Trackon history
   * still contains the earlier PRSS pickup-success scan.
   */
  current =
    await ensureFulfillmentAfterPickup(
      current,
      tracking
    );

  if (
    !current.shopifyFulfillmentId
  ) {
    return current;
  }

  /**
   * If the worker was temporarily offline and Trackon is already at a
   * later milestone, lstDetails allows us to backfill the missing
   * Out for Delivery event before Delivered.
   */
  current =
    await createMilestoneEventOnce({
      shipment:
        current,

      tracking,

      codes:
        OUT_FOR_DELIVERY_CODES,

      status:
        "OUT_FOR_DELIVERY",

      message:
        (row) => {
          const city =
            row.CURRENT_CITY ||
            row.CurrentCity ||
            row.currentCity ||
            "";

          return city
            ? `Your shipment is out for delivery from ${city}.`
            : "Your shipment is out for delivery.";
        },

      sentAtField:
        "shopifyOutForDeliverySentAt",

      eventIdField:
        "shopifyOutForDeliveryEventId",
    });

  current =
    await sendAttemptedDeliveries(
      current,
      tracking
    );

  current =
    await createMilestoneEventOnce({
      shipment:
        current,

      tracking,

      codes:
        DELIVERED_CODES,

      status:
        "DELIVERED",

      message:
        "Your shipment has been delivered.",

      sentAtField:
        "shopifyDeliveredSentAt",

      eventIdField:
        "shopifyDeliveredEventId",
    });

  return current;
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

export async function runTrackingSyncOnce() {
  if (running) {
    return {
      skipped:
        true,

      reason:
        "already running",
    };
  }

  running = true;

  const results = [];

  try {
    const allShipments =
      await listShipments();

    const shipments =
      allShipments.filter(
        shouldPollShipment
      );

    for (
      const shipment of shipments
    ) {
      try {
        const raw =
          await trackTrackonAwb(
            shipment.awb,
            {
              mockScans:
                shipment.mockScans,
            }
          );

        const normalized =
          normalizeTrackonTracking(
            raw
          );

        const trackingPatch = {
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
        };

        await upsertShipment(
          shipment.orderId,
          trackingPatch
        );

        let currentShipment = {
          ...shipment,
          ...trackingPatch,
        };

        currentShipment =
          await syncShopifyMilestones(
            currentShipment,
            normalized
          );

        currentShipment =
          await syncStatusTags(
            currentShipment,
            normalized
          );

        currentShipment =
          await updateHistory(
            currentShipment,
            normalized
          );

        if (
          currentShipment.orderGid &&
          config.shopify
            .syncTrackingMetafields
        ) {
          try {
            await syncTrackingMetafields({
              orderGid:
                currentShipment.orderGid,

              status:
                normalized.status,

              city:
                normalized.city,

              trackingCode:
                normalized.trackingCode,

              awb:
                currentShipment.awb,

              history:
                renderHistory(
                  currentShipment.history
                ),

              shop:
                currentShipment.shop ||
                config.shopify.shop,
            });
          } catch (metaError) {
            await upsertShipment(
              currentShipment.orderId,
              {
                shopifyMetafieldSyncError:
                  String(
                    metaError?.message ||
                    metaError
                  ).slice(
                    0,
                    2000
                  ),
              }
            );
          }
        }

        results.push({
          orderId:
            shipment.orderId,

          awb:
            shipment.awb,

          ok:
            true,

          status:
            normalized.status,

          trackingCode:
            normalized.trackingCode,

          fulfilled:
            Boolean(
              currentShipment.shopifyFulfillmentId
            ),

          dispatchState:
            currentShipment.dispatchState ||
            "WAITING_FOR_PICKUP",
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
              ).slice(
                0,
                5000
              ),

            lastTrackingSyncAt:
              new Date().toISOString(),
          }
        );

        results.push({
          orderId:
            shipment.orderId,

          awb:
            shipment.awb,

          ok:
            false,

          error:
            String(
              error?.message ||
              error
            ),
        });
      }

      if (
        !config.trackon.mock
      ) {
        await sleep(400);
      }
    }

    return {
      skipped:
        false,

      count:
        results.length,

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
      config.trackon
        .pollMinutes
    );

  const run = () =>
    runTrackingSyncOnce().catch(
      (err) =>
        console.error(
          "tracking worker loop error",
          err
        )
    );

  // Poll once at startup, so a deploy or restart does not delay
  // pickup and delivery updates by a full interval.
  setImmediate(run);

  setInterval(run, minutes * 60 * 1000).unref();
}
