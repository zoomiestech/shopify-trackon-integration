import { config } from "../config.js";
import {
  leaseNextJob,
  completeJob,
  failJob,
  getShipment,
  upsertShipment,
} from "../lib/store.js";

import {
  createTrackonBooking,
} from "../services/trackon.js";

import {
  addOrderTags,
  removeOrderTags,
  createShopifyFulfillment,
  syncTrackingMetafields,
} from "../services/shopify.js";

import {
  fulfilShipment,
} from "../lib/fulfil-shipment.js";

import {
  shouldBookOrder,
  bookingChoice,
  bookingTags,
  BOOKING_FAILED_TAG,
} from "../lib/booking-tag.js";

import {
  publishBookingToShopify,
} from "../lib/booking-publish.js";

import {
  mergeHistory,
  renderHistory,
  FULFILLED_HISTORY_TEXT,
} from "../lib/trackon-history.js";

let running = false;

const BOOKING_TOPICS = new Set([
  "orders/create",
  "orders/updated",
]);

async function processOrderBooking(job) {
  const order = job.payload;
  const orderId = String(order.id);

  const orderGid =
    order.admin_graphql_api_id ||
    `gid://shopify/Order/${order.id}`;

  if (order.cancelled_at) {
    await upsertShipment(
      orderId,
      {
        orderGid,
        orderName:
          order.name,
        shop:
          job.shop,
        shopifyCancelled:
          true,
        lastOrderPayload:
          order,
      }
    );

    return;
  }

  let shipment =
    await getShipment(orderId);

  // Re-checked here, not only at the webhook: the tag may have been
  // removed, or an earlier job may have booked the AWB already.
  if (
    !shouldBookOrder({
      order,
      shipment,
      tag:
        config.shopify.bookingTag,
    })
  ) {
    console.log(
      `[booking] Skipped order ${orderId}: no booking tag, a ${BOOKING_FAILED_TAG} tag, or an AWB already exists`
    );
    return;
  }

  await upsertShipment(
    orderId,
    {
      orderGid,
      orderName:
        order.name,
      shop:
        job.shop,
      customerEmail:
        order.email ||
        order.contact_email ||
        "",
      lastOrderPayload:
        order,
    }
  );

  shipment =
    await getShipment(orderId);

  /**
   * Book with Trackon, write the AWB to Shopify (metafields and tag),
   * then fulfil the order with the tracking number and email the
   * customer. Pickup is not waited for.
   */
  if (!shipment?.awb) {
    const choice =
      bookingChoice(
        order,
        config.shopify.bookingTag
      );

    if (choice.conflict) {
      const tags =
        bookingTags(
          config.shopify.bookingTag
        );

      const conflict = new Error(
        `The order has both ${tags.air} and ${tags.sf} tags. Keep only one`
      );
      // Retrying cannot fix a conflicting choice; report it straight away.
      conflict.permanent = true;
      throw conflict;
    }

    const booking =
      await createTrackonBooking(
        order,
        {
          typeOfService:
            choice.typeOfService,
        }
      );

    const bookedAt =
      new Date().toISOString();

    const history =
      mergeHistory(
        shipment?.history,
        [
          {
            key: "booked",
            at: bookedAt,
            text: `Booked with Trackon (${choice.typeOfService}). AWB ${booking.awb}.`,
          },
        ]
      );

    await upsertShipment(
      orderId,
      {
        awb:
          booking.awb,

        trackonBookingPayload:
          booking.payload,

        trackonBookingResponse:
          booking.response,

        // Do not fake a BOKN/dispatch state at AWB creation time.
        trackingStatus:
          "AWB_CREATED",

        trackingCode:
          "",

        dispatchState:
          "BOOKED",

        bookingCreatedAt:
          bookedAt,

        typeOfService:
          choice.typeOfService,

        history,

        lastError:
          null,
      }
    );

    // Show the AWB in Shopify Admin now, without fulfilling the order.
    const published =
      await publishBookingToShopify(
        {
          orderGid,
          awb:
            booking.awb,
          shop:
            job.shop ||
            config.shopify.shop,
          bookedTag:
            config.shopify.bookedTag,
          history:
            renderHistory(history),
          removeTags:
            shipment?.bookingFailedTaggedAt
              ? [BOOKING_FAILED_TAG]
              : [],
        },
        {
          syncTrackingMetafields,
          addOrderTags,
          removeOrderTags,
        }
      );

    if (published.ok) {
      await upsertShipment(
        orderId,
        {
          shopifyBookingPublishedAt:
            new Date().toISOString(),
          shopifyBookingPublishError:
            null,
          bookingFailedTaggedAt:
            null,
        }
      );
    } else {
      console.error(
        `[booking] AWB ${booking.awb} saved, but Shopify update failed for order ${orderId}`,
        published.errors
      );

      await upsertShipment(
        orderId,
        {
          shopifyBookingPublishError:
            published.errors
              .join("; ")
              .slice(0, 5000),
          shopifyBookingPublishErrorAt:
            new Date().toISOString(),
        }
      );
    }

    // With the AWB booked and in the metafields, fulfil the order with the
    // tracking number and email the customer. If Shopify fails here, the
    // tracking poll retries the fulfillment; the booking is not repeated.
    const fulfil =
      await fulfilShipment(
        {
          orderId,
          orderGid,
          awb:
            booking.awb,
          shop:
            job.shop ||
            config.shopify.shop,
        },
        {
          createShopifyFulfillment,
        }
      );

    if (fulfil.patch) {
      await upsertShipment(
        orderId,
        fulfil.patch
      );
    }

    if (fulfil.fulfilled) {
      await recordFulfilledInHistory({
        orderId,
        orderGid,
        awb:
          booking.awb,
        shop:
          job.shop ||
          config.shopify.shop,
        history,
        fulfilledAt:
          fulfil.patch
            .shopifyFulfillmentCreatedAt,
      });

      console.log(
        `[booking] Order ${orderId} fulfilled with AWB ${booking.awb}; customer emailed`
      );
    } else if (fulfil.error) {
      console.error(
        `[booking] AWB ${booking.awb} saved, but the Shopify fulfillment failed for order ${orderId}; the tracking poll will retry`,
        fulfil.error
      );
    }
  }
}

async function recordFulfilledInHistory({
  orderId,
  orderGid,
  awb,
  shop,
  history,
  fulfilledAt,
}) {
  const updated =
    mergeHistory(
      history,
      [
        {
          key: "fulfilled",
          at: fulfilledAt,
          text: FULFILLED_HISTORY_TEXT,
        },
      ]
    );

  await upsertShipment(
    orderId,
    { history: updated }
  );

  try {
    await syncTrackingMetafields({
      orderGid,
      status:
        "AWB_CREATED",
      awb,
      history:
        renderHistory(updated),
      shop,
    });
  } catch (error) {
    console.error(
      `[booking] Could not write the fulfilled history line to Shopify for order ${orderId}; the tracking poll will rewrite it`,
      error?.response?.data ||
      error
    );

    await upsertShipment(
      orderId,
      {
        shopifyMetafieldSyncError:
          String(
            error?.message ||
            error
          ).slice(0, 2000),
      }
    );
  }
}

async function processCancellation(
  job
) {
  const order =
    job.payload;

  const orderId =
    String(order.id);

  await upsertShipment(
    orderId,
    {
      orderGid:
        order.admin_graphql_api_id ||
        `gid://shopify/Order/${order.id}`,

      orderName:
        order.name,

      shop:
        job.shop,

      shopifyCancelled:
        true,

      cancellationReceivedAt:
        new Date().toISOString(),

      lastOrderPayload:
        order,

      warning:
        "Shopify order cancelled. No automatic Trackon cancellation is attempted because the supplied Trackon PDF does not document a cancellation endpoint.",
    }
  );
}

/**
 * Every attempt failed. Tell staff in Shopify: the trackon-booking-failed
 * tag to filter on, and the reason in trackon.history. Staff fix the order
 * and remove the tag, which sends orders/updated and books again.
 */
async function reportFinalBookingFailure(
  job,
  error
) {
  const order =
    job.payload;

  const topic =
    String(
      job.topic || ""
    ).toLowerCase();

  if (
    !order?.id ||
    !BOOKING_TOPICS.has(topic) ||
    !bookingChoice(
      order,
      config.shopify.bookingTag
    ).book
  ) {
    return;
  }

  const orderId =
    String(order.id);

  const shipment =
    await getShipment(orderId);

  if (shipment?.awb) {
    return;
  }

  const orderGid =
    shipment?.orderGid ||
    order.admin_graphql_api_id ||
    `gid://shopify/Order/${order.id}`;

  const now =
    new Date().toISOString();

  const reason =
    String(
      error?.message ||
      error
    ).slice(0, 300);

  const history =
    mergeHistory(
      shipment?.history,
      [
        {
          key: `booking-failed:${now}`,
          at: now,
          text:
            (error?.permanent
              ? `Booking not attempted: ${reason}. `
              : `Booking failed after ${job.attempts || 1} attempts: ${reason}. `) +
            `Fix the order, then remove the ${BOOKING_FAILED_TAG} tag to retry.`,
        },
      ]
    );

  await upsertShipment(
    orderId,
    { history }
  );

  try {
    await addOrderTags({
      orderGid,
      tags: [BOOKING_FAILED_TAG],
      shop:
        job.shop ||
        config.shopify.shop,
    });

    await upsertShipment(
      orderId,
      {
        bookingFailedTaggedAt:
          now,
      }
    );

    await syncTrackingMetafields({
      orderGid,
      status:
        "BOOKING_FAILED",
      history:
        renderHistory(history),
      shop:
        job.shop ||
        config.shopify.shop,
    });
  } catch (reportError) {
    console.error(
      `[booking] Could not report the booking failure to Shopify for order ${orderId}`,
      reportError?.response?.data ||
      reportError
    );

    await upsertShipment(
      orderId,
      {
        shopifyBookingFailureReportError:
          String(
            reportError?.message ||
            reportError
          ).slice(0, 2000),
      }
    );
  }
}

async function processJob(job) {
  const topic =
    String(
      job.topic || ""
    ).toLowerCase();

  if (
    topic ===
    "orders/cancelled"
  ) {
    return processCancellation(
      job
    );
  }

  // orders/paid and other topics may still arrive from old
  // webhook subscriptions; they never book.
  if (
    !BOOKING_TOPICS.has(topic)
  ) {
    return;
  }

  return processOrderBooking(
    job
  );
}

export async function runBookingWorkerOnce() {
  if (running) {
    return;
  }

  running = true;

  try {
    const job =
      await leaseNextJob();

    if (!job) {
      return;
    }

    try {
      await processJob(job);

      await completeJob(
        job.jobId ||
        job.id
      );

      console.log(
        `[job ${job.jobId || job.id}] completed ${job.topic}`
      );
    } catch (error) {
      console.error(
        `[job ${job.jobId || job.id}] failed`,
        error?.response?.data ||
        error
      );

      const { final } =
        await failJob(
          job.jobId ||
          job.id,
          error,
          Math.min(
            60 *
              (job.attempts || 1),
            300
          )
        );

      const orderId =
        job.payload?.id;

      if (orderId) {
        await upsertShipment(
          String(orderId),
          {
            lastError:
              String(
                error?.response?.data
                  ? JSON.stringify(
                      error.response
                        .data
                    )
                  : error?.message ||
                    error
              ).slice(
                0,
                5000
              ),

            lastErrorAt:
              new Date().toISOString(),
          }
        );
      }

      if (final) {
        await reportFinalBookingFailure(
          job,
          error
        );
      }
    }
  } finally {
    running = false;
  }
}

export function startBookingWorker() {
  setInterval(() => {
    runBookingWorkerOnce().catch(
      (err) =>
        console.error(
          "booking worker loop error",
          err
        )
    );
  }, 2000).unref();
}
