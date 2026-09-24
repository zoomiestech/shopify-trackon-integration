import { config } from "../config.js";
import {
  leaseNextJob,
  completeJob,
  failJob,
  getShipment,
  upsertShipment,
} from "../lib/store.js";
import { createTrackonBooking } from "../services/trackon.js";
import { createShopifyFulfillment } from "../services/shopify.js";

let running = false;

function topicToTrigger(topic) {
  const normalized = String(topic || "").toLowerCase().replace("/", "_");
  return normalized;
}

async function processOrderBooking(job) {
  const order = job.payload;
  const orderId = String(order.id);
  const orderGid =
    order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`;

  if (order.cancelled_at) {
    await upsertShipment(orderId, {
      orderGid,
      orderName: order.name,
      shop: job.shop,
      shopifyCancelled: true,
      lastOrderPayload: order,
    });
    return;
  }

  let shipment = getShipment(orderId);

  // Save enough payload for a manual retry without waiting for another webhook.
  await upsertShipment(orderId, {
    orderGid,
    orderName: order.name,
    shop: job.shop,
    customerEmail: order.email || order.contact_email || "",
    lastOrderPayload: order,
  });

  shipment = getShipment(orderId);

  // Idempotency: never create a second Trackon AWB if one is already saved.
  if (!shipment?.awb) {
    const booking = await createTrackonBooking(order);

    await upsertShipment(orderId, {
      awb: booking.awb,
      trackonBookingPayload: booking.payload,
      trackonBookingResponse: booking.response,
      trackingStatus: "BOOKED",
      trackingCode: "BOKN",
      bookingCreatedAt: new Date().toISOString(),
    });
  }

  shipment = getShipment(orderId);

  // If Trackon succeeded but Shopify fulfillment failed, retries start here,
  // reusing the existing AWB rather than creating a duplicate shipment.
  if (!shipment?.shopifyFulfillmentId) {
    const fulfillment = await createShopifyFulfillment({
      orderGid,
      awb: shipment.awb,
      shop: job.shop || config.shopify.shop,
    });

    await upsertShipment(orderId, {
      shopifyFulfillmentId: fulfillment.id,
      shopifyFulfillmentStatus: fulfillment.status,
      shopifyFulfillmentCreatedAt: new Date().toISOString(),
      shopifyFulfillmentError: null,
    });
  }
}

async function processCancellation(job) {
  const order = job.payload;
  const orderId = String(order.id);
  await upsertShipment(orderId, {
    orderGid:
      order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`,
    orderName: order.name,
    shop: job.shop,
    shopifyCancelled: true,
    cancellationReceivedAt: new Date().toISOString(),
    lastOrderPayload: order,
    warning:
      "Shopify order cancelled. No automatic Trackon cancellation is attempted because the supplied Trackon PDF does not document a cancellation endpoint.",
  });
}

async function processJob(job) {
  const topic = String(job.topic || "").toLowerCase();

  if (topic === "orders/cancelled") {
    return processCancellation(job);
  }

  const expected = config.shopify.bookingTrigger;
  if (topicToTrigger(topic) !== expected) {
    return;
  }

  return processOrderBooking(job);
}

export async function runBookingWorkerOnce() {
  if (running) return;
  running = true;
  try {
    const job = await leaseNextJob();
    if (!job) return;

    try {
      await processJob(job);
      await completeJob(job.id);
      console.log(`[job ${job.id}] completed ${job.topic}`);
    } catch (error) {
      console.error(`[job ${job.id}] failed`, error?.response?.data || error);
      await failJob(job.id, error, Math.min(60 * (job.attempts || 1), 300));

      const orderId = job.payload?.id;
      if (orderId) {
        await upsertShipment(String(orderId), {
          lastError: String(
            error?.response?.data
              ? JSON.stringify(error.response.data)
              : error?.message || error
          ).slice(0, 5000),
          lastErrorAt: new Date().toISOString(),
        });
      }
    }
  } finally {
    running = false;
  }
}

export function startBookingWorker() {
  setInterval(() => {
    runBookingWorkerOnce().catch((err) =>
      console.error("booking worker loop error", err)
    );
  }, 2000).unref();
}
