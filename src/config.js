import "dotenv/config";

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeShop(shop) {
  if (!shop) return "";
  let out = String(shop).trim().toLowerCase();
  out = out.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!out.endsWith(".myshopify.com")) out += ".myshopify.com";
  return out;
}

export const config = {
  port: int(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  adminApiKey: process.env.ADMIN_API_KEY || "",

  mongodb: {
    uri: process.env.MONGODB_URI || "",
    dbName: process.env.MONGODB_DB || "shopify_trackon",
  },

  shopify: {
    apiVersion: process.env.SHOPIFY_API_VERSION || "2026-07",
    shop: normalizeShop(process.env.SHOPIFY_SHOP),
    clientId: process.env.SHOPIFY_CLIENT_ID || "",
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || "",
    authMode: process.env.SHOPIFY_AUTH_MODE || "client_credentials",
    scopes: (process.env.SHOPIFY_SCOPES ||
      "read_orders,write_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    staticAccessToken: process.env.SHOPIFY_ACCESS_TOKEN || "",
    bookingTrigger: process.env.BOOKING_TRIGGER || "orders_create",
    notifyCustomer: bool(process.env.SHOPIFY_NOTIFY_CUSTOMER, false),
    syncTrackingMetafields: bool(process.env.SHOPIFY_SYNC_TRACKING_METAFIELDS, true),
  },

  trackon: {
    mock: bool(process.env.TRACKON_MOCK, true),
    bookingUrl:
      process.env.TRACKON_BOOKING_URL ||
      "https://api.trackon.in/CrmApi/Crm/UploadPickupRequestWithoutDockNo",
    trackingUrl:
      process.env.TRACKON_TRACKING_URL ||
      "https://api.trackon.in/CrmApi/t1/AWBTrackingCustomer",
    appKey: process.env.TRACKON_APP_KEY || "",
    userId: process.env.TRACKON_USER_ID || "",
    password: process.env.TRACKON_PASSWORD || "",
    customerCode: process.env.TRACKON_CUSTOMER_CODE || "",
    pickupCustomerCode: process.env.TRACKON_PICKUP_CUSTOMER_CODE || "",
    typeOfService: process.env.TRACKON_TYPE_OF_SERVICE || "",
    serviceType: process.env.TRACKON_SERVICE_TYPE || "Parcel",
    bookingBodyMode: (process.env.TRACKON_BOOKING_BODY_MODE || "json").toLowerCase(),
    defaultWeightKg: Number(process.env.TRACKON_DEFAULT_WEIGHT_KG || 1),
    defaultPieces: int(process.env.TRACKON_DEFAULT_PIECES, 1),
    timeoutMs: int(process.env.TRACKON_TIMEOUT_MS, 15000),
    pollMinutes: int(process.env.TRACKING_POLL_MINUTES, 60),
    pickup: {
      name: process.env.PICKUP_NAME || "",
      address: process.env.PICKUP_ADDRESS || "",
      city: process.env.PICKUP_CITY || "",
      state: process.env.PICKUP_STATE || "",
      pincode: process.env.PICKUP_PINCODE || "",
      phone: process.env.PICKUP_PHONE || "",
    },
  },
};

export function validateBaseConfig() {
  const errors = [];

  if (!config.mongodb.uri) errors.push("MONGODB_URI is missing");

  if (!config.shopify.clientId) errors.push("SHOPIFY_CLIENT_ID is missing");
  if (!config.shopify.clientSecret) errors.push("SHOPIFY_CLIENT_SECRET is missing");

  if (!config.shopify.shop && config.shopify.authMode === "client_credentials") {
    errors.push("SHOPIFY_SHOP is missing");
  }

  if (!config.adminApiKey || config.adminApiKey === "change-this-to-a-long-random-secret") {
    errors.push("ADMIN_API_KEY should be set to a strong secret");
  }

  if (!["client_credentials", "oauth"].includes(config.shopify.authMode)) {
    errors.push("SHOPIFY_AUTH_MODE must be client_credentials or oauth");
  }

  if (!["orders_create", "orders_paid"].includes(config.shopify.bookingTrigger)) {
    errors.push("BOOKING_TRIGGER must be orders_create or orders_paid");
  }

  return errors;
}
