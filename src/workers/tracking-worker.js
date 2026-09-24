import { config } from "../config.js";
import { listShipments, upsertShipment } from "../lib/store.js";
import {
  trackTrackonAwb,
  normalizeTrackonTracking,
} from "../services/trackon.js";
import { syncTrackingMetafields } from "../services/shopify.js";

let running = false;

const TERMINAL_CODES = new Set([
  "DDUB", "DDUF", "DDUA", // delivered variants
  "RHOD"                  // RTO delivered
]);

function isTerminal(shipment) {
  if (TERMINAL_CODES.has(String(shipment.trackingCode || "").toUpperCase())) {
    return true;
  }
  const status = String(shipment.trackingStatus || "").toLowerCase();
  return status.includes("delivered") && !status.includes("undelivered");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTrackingSyncOnce() {
  if (running) return { skipped: true, reason: "already running" };
  running = true;

  const results = [];
  try {
    const shipments = listShipments().filter(
      (s) => s.awb && !isTerminal(s) && !s.shopifyCancelled
    );

    for (const shipment of shipments) {
      try {
        const raw = await trackTrackonAwb(shipment.awb);
        const normalized = normalizeTrackonTracking(raw);

        await upsertShipment(shipment.orderId, {
          trackingStatus: normalized.status,
          trackingCode: normalized.trackingCode,
          currentCity: normalized.city,
          eventDate: normalized.eventDate,
          eventTime: normalized.eventTime,
          ndrReason: normalized.ndrReason,
          trackingDetails: normalized.details,
          trackonTrackingResponse: raw,
          lastTrackingSyncAt: new Date().toISOString(),
          lastTrackingError: null,
        });

        if (shipment.orderGid && config.shopify.syncTrackingMetafields) {
          try {
            await syncTrackingMetafields({
              orderGid: shipment.orderGid,
              status: normalized.status,
              city: normalized.city,
              trackingCode: normalized.trackingCode,
              awb: shipment.awb,
              shop: shipment.shop || config.shopify.shop,
            });
          } catch (metaError) {
            await upsertShipment(shipment.orderId, {
              shopifyMetafieldSyncError: String(
                metaError?.message || metaError
              ).slice(0, 2000),
            });
          }
        }

        results.push({
          orderId: shipment.orderId,
          awb: shipment.awb,
          ok: true,
          status: normalized.status,
          trackingCode: normalized.trackingCode,
        });
      } catch (error) {
        await upsertShipment(shipment.orderId, {
          lastTrackingError: String(
            error?.response?.data
              ? JSON.stringify(error.response.data)
              : error?.message || error
          ).slice(0, 5000),
          lastTrackingSyncAt: new Date().toISOString(),
        });
        results.push({
          orderId: shipment.orderId,
          awb: shipment.awb,
          ok: false,
          error: String(error?.message || error),
        });
      }

      // Be polite to Trackon's API; adjust after they confirm rate limits.
      if (!config.trackon.mock) await sleep(400);
    }

    return { skipped: false, count: results.length, results };
  } finally {
    running = false;
  }
}

export function startTrackingWorker() {
  const minutes = Math.max(5, config.trackon.pollMinutes);
  setInterval(() => {
    runTrackingSyncOnce().catch((err) =>
      console.error("tracking worker loop error", err)
    );
  }, minutes * 60 * 1000).unref();
}
