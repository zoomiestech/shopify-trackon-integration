import axios from "axios";
import crypto from "node:crypto";
import { config } from "../config.js";

function text(value, max = 9999) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}

function stableSerial(order) {
  const raw = String(order.id || order.order_number || Date.now()).replace(/\D/g, "");
  const tail = raw.slice(-6) || "1";
  return String(Number(tail) || 1);
}

function calculateWeightKg(order) {
  let grams = 0;
  for (const item of order.line_items || []) {
    const g = Number(item.grams || 0);
    const qty = Number(item.quantity || 1);
    if (Number.isFinite(g) && g > 0) grams += g * qty;
  }
  if (grams > 0) return (grams / 1000).toFixed(3);
  return Number(config.trackon.defaultWeightKg || 1).toFixed(3);
}

function itemDescription(order) {
  const titles = (order.line_items || [])
    .map((i) => i.title || i.name)
    .filter(Boolean)
    .join(", ");
  return text(titles || "Shopify order", 100);
}

export function mapShopifyOrderToTrackon(order) {
  const addr = order.shipping_address;
  if (!addr) throw new Error("Shopify order has no shipping address.");

  const mobile = addr.phone || order.phone || order.billing_address?.phone || "";
  if (!mobile) throw new Error("Receiver mobile number is missing.");
  if (!addr.address1) throw new Error("Receiver address line 1 is missing.");
  if (!addr.zip) throw new Error("Receiver pincode is missing.");

  const payload = {
    Appkey: config.trackon.appKey,
    userId: config.trackon.userId,
    password: config.trackon.password,

    SerialNo: stableSerial(order),
    RefNo: text(order.name || order.order_number || order.id, 20),
    ActionType: "Book",
    CustomerCode: text(config.trackon.customerCode, 20),

    ClientName: text(addr.name || `${addr.first_name || ""} ${addr.last_name || ""}`, 30),
    AddressLine1: text(addr.address1, 200),
    AddressLine2: text(addr.address2, 200),
    City: text(addr.city, 200),
    PinCode: text(addr.zip, 15),
    MobileNo: text(mobile.replace(/\D/g, "").slice(-10), 10),
    Email: text(order.email || order.contact_email, 30),

    DocType: "N",
    TypeOfService: text(config.trackon.typeOfService, 20),
    Weight: calculateWeightKg(order),
    InvoiceValue: text(order.current_total_price || order.total_price || "0", 20),
    NoOfPieces: String(config.trackon.defaultPieces || 1),
    ItemName: itemDescription(order),
    Remark: text(`Shopify ${order.name || order.id}`, 250),

    ServiceType: text(config.trackon.serviceType, 10),
  };

  if (config.trackon.pickupCustomerCode) {
    payload.PickupCustCode = text(config.trackon.pickupCustomerCode, 10);
  } else {
    payload.PickupCustName = text(config.trackon.pickup.name, 100);
    payload.PickupAddr = text(config.trackon.pickup.address, 250);
    payload.PickupCity = text(config.trackon.pickup.city, 100);
    payload.PickupState = text(config.trackon.pickup.state, 50);
    payload.PickupPincode = text(config.trackon.pickup.pincode, 6);
    payload.PickupPhone = text(config.trackon.pickup.phone, 12);
  }

  return payload;
}

function mockAwb(refNo) {
  const hash = crypto.createHash("sha256").update(String(refNo)).digest("hex");
  const numeric = BigInt(`0x${hash.slice(0, 14)}`).toString();
  return numeric.slice(0, 12).padStart(12, "5");
}

function findAwbRecursive(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return null;

  if (typeof value === "string" || typeof value === "number") {
    const match = String(value).match(/\b\d{10,15}\b/);
    return match?.[0] || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAwbRecursive(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    const preferred = Object.entries(value).filter(([key]) =>
      /(awb|docket|tracking)/i.test(key)
    );
    for (const [, val] of preferred) {
      const found = findAwbRecursive(val, depth + 1);
      if (found) return found;
    }
    for (const val of Object.values(value)) {
      const found = findAwbRecursive(val, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function assertRealCredentials() {
  if (config.trackon.mock) return;
  const missing = [];
  if (!config.trackon.appKey) missing.push("TRACKON_APP_KEY");
  if (!config.trackon.userId) missing.push("TRACKON_USER_ID");
  if (!config.trackon.password) missing.push("TRACKON_PASSWORD");
  if (missing.length) throw new Error(`Missing Trackon credentials: ${missing.join(", ")}`);
}

export async function createTrackonBooking(order) {
  const payload = mapShopifyOrderToTrackon(order);

  if (config.trackon.mock) {
    const awb = mockAwb(payload.RefNo);
    return {
      awb,
      payload,
      response: {
        mock: true,
        DocketNo: awb,
        message: "MOCK Trackon booking; no external request was sent.",
      },
    };
  }

  assertRealCredentials();

  let data;
  if (config.trackon.bookingBodyMode === "form") {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) body.set(key, value ?? "");
    const response = await axios.post(config.trackon.bookingUrl, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: config.trackon.timeoutMs,
    });
    data = response.data;
  } else {
    const response = await axios.post(config.trackon.bookingUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: config.trackon.timeoutMs,
    });
    data = response.data;
  }

  const awb = findAwbRecursive(data);
  if (!awb) {
    const err = new Error(
      "Trackon booking responded, but no AWB/Docket number could be extracted. Inspect the saved raw response and update the extractor if Trackon's live response shape differs from the PDF."
    );
    err.trackonResponse = data;
    throw err;
  }

  return { awb, payload, response: data };
}

export async function trackTrackonAwb(awb) {
  if (config.trackon.mock) {
    return {
      summaryTrack: {
        AWBNO: String(awb),
        CURRENT_STATUS: "MOCK - SHIPMENT BOOKED",
        CURRENT_CITY: "",
        TRACKING_CODE: "BOKN",
        EVENTDATE: new Date().toISOString().slice(0, 10),
        EVENTTIME: new Date().toTimeString().slice(0, 8),
        NDR_REASON: "",
      },
      lstDetails: [],
      ResponseStatus: { ErrorCode: null, Message: "SUCCESS", Errors: null },
    };
  }

  assertRealCredentials();

  const { data } = await axios.get(config.trackon.trackingUrl, {
    params: {
      AWBNo: awb,
      AppKey: config.trackon.appKey,
      userID: config.trackon.userId,
      Password: config.trackon.password,
    },
    headers: { Accept: "application/json" },
    timeout: config.trackon.timeoutMs,
  });

  return data;
}

export function normalizeTrackonTracking(data) {
  const summary = data?.summaryTrack || data?.SummaryTrack || data?.summary || {};
  return {
    awb: summary.AWBNO || summary.AWBNo || summary.awb || "",
    status: summary.CURRENT_STATUS || summary.CurrentStatus || "",
    city: summary.CURRENT_CITY || summary.CurrentCity || "",
    trackingCode: summary.TRACKING_CODE || summary.TrackingCode || "",
    eventDate: summary.EVENTDATE || "",
    eventTime: summary.EVENTTIME || "",
    ndrReason: summary.NDR_REASON || "",
    details: data?.lstDetails || data?.LstDetails || data?.details || [],
    responseStatus: data?.ResponseStatus || data?.responseStatus || null,
    raw: data,
  };
}
