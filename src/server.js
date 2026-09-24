import express from "express";
import crypto from "node:crypto";
import { config, validateBaseConfig } from "./config.js";
import { connectMongo, mongoStatus } from "./lib/mongodb.js";
import { verifyShopifyWebhook } from "./lib/hmac.js";
import {
  recordWebhookAndEnqueue,
  listShipments,
  listJobs,
  enqueueJob,
  getShipment,
  databaseCounts,
} from "./lib/store.js";
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
} from "./workers/booking-worker.js";
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
        runBookingWorkerOnce().catch(console.error)
      );
    } catch (error) {
      console.error(
        "Webhook handler error",
        error
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
    bookingTrigger:
      config.shopify.bookingTrigger,
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
        error
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
        bookingTrigger:
          config.shopify.bookingTrigger,
        trackonMock:
          config.trackon.mock,
        trackonServiceType:
          config.trackon.serviceType,
        trackonTypeOfServiceConfigured:
          Boolean(
            config.trackon.typeOfService
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

    const triggerTopic =
      config.shopify.bookingTrigger ===
      "orders_paid"
        ? "orders/paid"
        : "orders/create";

    const job = await enqueueJob({
      type: "manual_retry",
      topic: triggerTopic,
      shop:
        shipment.shop ||
        config.shopify.shop,
      payload:
        shipment.lastOrderPayload,
    });

    setImmediate(() =>
      runBookingWorkerOnce().catch(
        console.error
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

app.use((err, req, res, next) => {
  console.error(
    "Unhandled Express error",
    err
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
    `Booking trigger: ${config.shopify.bookingTrigger}`
  );
});

startBookingWorker();
startTrackingWorker();
