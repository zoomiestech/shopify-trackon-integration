import express from "express";
import crypto from "node:crypto";
import { config, validateBaseConfig } from "./config.js";
import { connectMongo, mongoStatus } from "./lib/mongodb.js";
import { verifyShopifyWebhook } from "./lib/hmac.js";
import { safeError } from "./lib/safe-error.js";
import {
  shouldEnqueueOrderWebhook,
  bookingTags,
} from "./lib/booking-tag.js";
import {
  recordWebhookAndEnqueue,
  listShipments,
  listJobs,
  enqueueJob,
  getShipment,
  upsertShipment,
  databaseCounts,
} from "./lib/store.js";
import {
  buildMockScan,
  MOCK_TRACK_CODES,
} from "./lib/mock-tracking.js";
import {
  buildInstallUrl,
  handleOauthCallback,
} from "./services/shopify-auth.js";
import {
  registerDefaultWebhooks,
  testShopifyConnection,
} from "./services/shopify.js";
import {
  runBookingWorkerOnce,
  startBookingWorker,
  finishBooking,
} from "./workers/booking-worker.js";
import { attachAwbProblem } from "./lib/attach-awb.js";
import {
  runTrackingSyncOnce,
  startTrackingWorker,
} from "./workers/tracking-worker.js";

await connectMongo();

const app = express();

function eventIdFrom(req) {
  return (
    req.get("x-shopify-event-id") ||
    req.get("x-shopify-webhook-id") ||
    req.get("webhook-id") ||
    crypto.randomUUID()
  );
}

// Raw middleware MUST run before express.json() for Shopify HMAC verification.
app.post(
  "/webhooks/orders",
  express.raw({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    try {
      const valid = verifyShopifyWebhook(
        req.body,
        req.get("x-shopify-hmac-sha256"),
        config.shopify.clientSecret
      );

      if (!valid) {
        return res
          .status(401)
          .send("Invalid Shopify webhook signature");
      }

      const topic =
        req.get("x-shopify-topic") || "";

      const shop =
        req.get("x-shopify-shop-domain") ||
        config.shopify.shop;

      const eventId = eventIdFrom(req);
      const payload = JSON.parse(
        req.body.toString("utf8")
      );

      // Most order webhooks (every edit of every order) are not ours to
      // act on. Acknowledge them without storing anything.
      const shipment = payload?.id
        ? await getShipment(payload.id)
        : null;

      if (
        !shouldEnqueueOrderWebhook({
          topic,
          order: payload,
          shipment,
          tag: config.shopify.bookingTag,
        })
      ) {
        return res.status(200).json({
          ok: true,
          ignored: true,
          eventId,
        });
      }

      const result =
        await recordWebhookAndEnqueue({
          eventId,
          topic,
          shop,
          payload,
        });

      res.status(200).json({
        ok: true,
        duplicate: result.duplicate,
        eventId,
      });

      setImmediate(() =>
        runBookingWorkerOnce().catch((err) => console.error("booking worker error", safeError(err)))
      );
    } catch (error) {
      console.error(
        "Webhook handler error",
        safeError(error)
      );

      res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }
);

app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.type("html").send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Shopify ↔ Trackon Bridge</title>
      </head>
      <body style="font-family:system-ui;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.5">
        <h1>Shopify ↔ Trackon Bridge</h1>
        <p>Server is running with MongoDB persistence.</p>
        <ul>
          <li><a href="/health">Health</a></li>
          ${
            config.shopify.authMode === "oauth"
              ? `<li>OAuth install: <code>/auth/install?shop=your-store.myshopify.com</code></li>`
              : ""
          }
        </ul>
        <p>Admin endpoints require the <code>x-admin-key</code> header.</p>
      </body>
    </html>
  `);
});

app.get("/health", async (req, res) => {
  let counts = null;

  try {
    counts = await databaseCounts();
  } catch {
    counts = null;
  }

  res.json({
    ok: true,
    service: "shopify-trackon-bridge",
    persistence: "mongodb",
    mongodb: mongoStatus(),
    databaseCounts: counts,
    nodeEnv: config.nodeEnv,
    trackonMock: config.trackon.mock,
    shopifyApiVersion:
      config.shopify.apiVersion,
    bookingTag:
      config.shopify.bookingTag,
    time: new Date().toISOString(),
  });
});

app.get("/auth/install", async (req, res) => {
  try {
    if (
      config.shopify.authMode !== "oauth"
    ) {
      return res
        .status(400)
        .send(
          "SHOPIFY_AUTH_MODE is not oauth."
        );
    }

    const shop = String(
      req.query.shop ||
        config.shopify.shop ||
        ""
    );

    const url = await buildInstallUrl(shop);
    res.redirect(url);
  } catch (error) {
    res.status(400).send(error.message);
  }
});

app.get(
  "/auth/callback",
  async (req, res) => {
    try {
      const result =
        await handleOauthCallback(req.query);

      res.type("html").send(`
        <h2>Shopify app authorized</h2>
        <p>Shop: ${result.shop}</p>
        <p>Next: register webhooks using the admin endpoint or <code>npm run register-webhooks</code>.</p>
      `);
    } catch (error) {
      console.error(
        "OAuth callback error",
        safeError(error)
      );
      res.status(400).send(error.message);
    }
  }
);

function requireAdmin(req, res, next) {
  if (!config.adminApiKey) {
    return res.status(503).json({
      error:
        "ADMIN_API_KEY not configured",
    });
  }

  if (
    req.get("x-admin-key") !==
    config.adminApiKey
  ) {
    return res.status(401).json({
      error: "Invalid admin key",
    });
  }

  next();
}

app.get(
  "/admin/status",
  requireAdmin,
  async (req, res) => {
    let shopify = null;
    let shopifyError = null;

    try {
      shopify =
        await testShopifyConnection(
          req.query.shop ||
            config.shopify.shop
        );
    } catch (error) {
      shopifyError =
        error?.response?.data ||
        error.message;
    }

    res.json({
      config: {
        publicBaseUrl:
          config.publicBaseUrl,
        shop:
          req.query.shop ||
          config.shopify.shop,
        shopifyAuthMode:
          config.shopify.authMode,
        shopifyApiVersion:
          config.shopify.apiVersion,
        bookingTag:
          config.shopify.bookingTag,
        trackonMock:
          config.trackon.mock,
        trackonServiceType:
          config.trackon.serviceType,
        bookingTags:
          bookingTags(
            config.shopify.bookingTag
          ),
        trackonCredentialsConfigured:
          Boolean(
            config.trackon.appKey &&
              config.trackon.userId &&
              config.trackon.password
          ),
        persistence: "mongodb",
        mongodb: mongoStatus(),
      },
      shopify,
      shopifyError,
      databaseCounts:
        await databaseCounts(),
      startupWarnings:
        validateBaseConfig(),
    });
  }
);

app.post(
  "/admin/register-webhooks",
  requireAdmin,
  async (req, res) => {
    try {
      // Optional chaining intentionally supports POSTs with an empty body.
      const shop =
        req.body?.shop ||
        config.shopify.shop;

      const result =
        await registerDefaultWebhooks(shop);

      res.json({
        ok: true,
        result,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message,
        details:
          error?.response?.data || null,
      });
    }
  }
);

app.get(
  "/admin/shipments",
  requireAdmin,
  async (req, res) => {
    const shipments =
      await listShipments();

    const safe = shipments.map((s) => ({
      ...s,
      lastOrderPayload:
        s.lastOrderPayload
          ? "[stored in MongoDB]"
          : null,
      trackonBookingPayload:
        s.trackonBookingPayload
          ? "[stored in MongoDB]"
          : null,
    }));

    res.json({
      count: safe.length,
      shipments: safe,
    });
  }
);

app.get(
  "/admin/jobs",
  requireAdmin,
  async (req, res) => {
    res.json({
      jobs: await listJobs(200),
    });
  }
);

app.post(
  "/admin/retry-order/:orderId",
  requireAdmin,
  async (req, res) => {
    const shipment =
      await getShipment(
        req.params.orderId
      );

    if (!shipment?.lastOrderPayload) {
      return res.status(404).json({
        error:
          "No stored order payload exists for this order ID.",
      });
    }

    // The worker still requires the booking tag on the stored payload.
    const job = await enqueueJob({
      type: "manual_retry",
      topic: "orders/updated",
      shop:
        shipment.shop ||
        config.shopify.shop,
      payload:
        shipment.lastOrderPayload,
    });

    setImmediate(() =>
      runBookingWorkerOnce().catch((err) =>
        console.error("booking worker error", safeError(err))
      )
    );

    res.json({
      ok: true,
      jobId: job.jobId || job.id,
    });
  }
);

app.post(
  "/admin/run-tracking",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await runTrackingSyncOnce();

      res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }
);

// Attaches the AWB of a booking Trackon made but never confirmed (for
// example after a timeout), then finishes it like a normal booking:
// metafields, history, trackon-booked tag, fulfillment and customer email.
// Body: { "awb": "500664884543", "typeOfService": "Surface" (optional) }.
app.post(
  "/admin/attach-awb/:orderId",
  requireAdmin,
  async (req, res) => {
    try {
      const shipment =
        await getShipment(
          req.params.orderId
        );

      const problem =
        attachAwbProblem({
          awb: req.body?.awb,
          shipment,
        });

      if (problem) {
        return res.status(400).json({
          ok: false,
          error: problem,
        });
      }

      const awb =
        String(req.body.awb).trim();

      const typeOfService =
        ["Air", "Surface", "SF"].includes(
          req.body?.typeOfService
        )
          ? req.body.typeOfService
          : null;

      await finishBooking({
        orderId:
          shipment.orderId,
        orderGid:
          shipment.orderGid,
        shop:
          shipment.shop ||
          config.shopify.shop,
        awb,
        shipment,
        typeOfService,
        historyText:
          `AWB ${awb} attached by hand: Trackon booked it but did not confirm in time.`,
        extraPatch: {
          awbAttachedByHandAt:
            new Date().toISOString(),
        },
        removeFailedTag:
          true,
      });

      const updated =
        await getShipment(
          shipment.orderId
        );

      res.json({
        ok: true,
        orderId:
          updated.orderId,
        awb:
          updated.awb,
        dispatchState:
          updated.dispatchState,
        fulfilled:
          Boolean(
            updated.shopifyFulfillmentId
          ),
        shopifyBookingPublishError:
          updated.shopifyBookingPublishError ||
          null,
        shopifyFulfillmentError:
          updated.shopifyFulfillmentError ||
          null,
      });
    } catch (error) {
      console.error(
        "Attach AWB error",
        safeError(error)
      );

      res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }
);

// Development only: add a fake Trackon scan to a booked order, so every
// tracking step can be tested without a courier. ?run=true also polls now.
app.post(
  "/admin/mock-scan/:orderId",
  requireAdmin,
  async (req, res) => {
    if (!config.trackon.mock) {
      return res.status(404).json({
        error:
          "Mock scans are only available when TRACKON_MOCK=true.",
      });
    }

    try {
      const shipment =
        await getShipment(
          req.params.orderId
        );

      if (!shipment?.awb) {
        return res.status(404).json({
          error:
            "No booked shipment (with an AWB) exists for this order ID.",
        });
      }

      let scan;

      try {
        scan = buildMockScan({
          code: req.body?.code,
          status: req.body?.status,
          city: req.body?.city,
        });
      } catch (error) {
        return res.status(400).json({
          error: error.message,
          codes: MOCK_TRACK_CODES,
        });
      }

      const mockScans = [
        ...(shipment.mockScans || []),
        scan,
      ];

      await upsertShipment(
        shipment.orderId,
        { mockScans }
      );

      let tracking = null;

      if (req.query.run === "true") {
        const result =
          await runTrackingSyncOnce();

        tracking = result.skipped
          ? result
          : (result.results || []).find(
              (r) =>
                r.orderId ===
                shipment.orderId
            ) || {
              note:
                "This shipment was not polled: it is delivered, returned or cancelled.",
            };
      }

      res.json({
        ok: true,
        orderId: shipment.orderId,
        awb: shipment.awb,
        scan,
        scanCount: mockScans.length,
        tracking,
      });
    } catch (error) {
      console.error(
        "Mock scan error",
        safeError(error)
      );

      res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }
);

app.use((err, req, res, next) => {
  console.error(
    "Unhandled Express error",
    safeError(err)
  );

  res.status(500).json({
    error: "Internal server error",
  });
});

const warnings = validateBaseConfig();

if (warnings.length) {
  console.warn(
    "Startup configuration warnings:"
  );

  warnings.forEach((w) =>
    console.warn(` - ${w}`)
  );
}

app.listen(config.port, () => {
  console.log(
    `Shopify ↔ Trackon Bridge listening on :${config.port}`
  );
  console.log(
    `Persistence: MongoDB (${config.mongodb.dbName})`
  );
  console.log(
    `Trackon mock mode: ${config.trackon.mock}`
  );
  console.log(
    `Booking tag: ${config.shopify.bookingTag}`
  );
});

startBookingWorker();
startTrackingWorker();
