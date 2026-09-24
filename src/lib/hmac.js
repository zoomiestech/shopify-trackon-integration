import crypto from "node:crypto";

export function verifyShopifyWebhook(rawBody, providedHmac, secret) {
  if (!rawBody || !providedHmac || !secret) return false;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(String(providedHmac), "utf8");

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyShopifyOauthQuery(query, secret) {
  const hmac = String(query.hmac || "");
  if (!hmac || !secret) return false;

  const pairs = Object.entries(query)
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const str = Array.isArray(value) ? value.join(",") : String(value ?? "");
      return `${key}=${str}`;
    });

  const message = pairs.join("&");
  const computed = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(hmac, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isValidShopDomain(shop) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(String(shop || ""));
}
