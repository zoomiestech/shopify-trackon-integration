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

let running = false;

function topicToTrigger(topic) {
  return String(topic || "")
    .toLowerCase()
    .replace("/", "_");
}

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
   * STEP 1:
   * Create Trackon booking/AWB only.
   *
   * IMPORTANT:
   * We intentionally DO NOT create the Shopify fulfillment here.
   *
   * An AWB being generated does not mean the physical parcel has
   * been picked up by Trackon.
   *
   * The tracking worker waits for Trackon's PRSS
   * (Pickup Closure - Successful / Pickup Successful).
   */
  if (!shipment?.awb) {
    const booking =
      await createTrackonBooking(
        order
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
          "WAITING_FOR_PICKUP",

        bookingCreatedAt:
          new Date().toISOString(),

        lastError:
          null,
      }
    );
  }

  /**
   * Nothing else happens here.
   *
   * Shopify remains UNFULFILLED while Trackon has only created the AWB.
   *
   * Later:
   * Trackon PRSS
   * -> tracking-worker.js
   * -> create Shopify fulfillment
   * -> notifyCustomer: true
   * -> customer receives the dispatch/shipping email.
   */
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

  const expected =
    config.shopify
      .bookingTrigger;

  if (
    topicToTrigger(topic) !==
    expected
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
