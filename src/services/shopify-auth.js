import axios from "axios";
import crypto from "node:crypto";
import { config } from "../config.js";
import {
  saveOauthState,
  consumeOauthState,
  saveOauthToken,
  getOauthToken,
} from "../lib/store.js";
import { verifyShopifyOauthQuery, isValidShopDomain } from "../lib/hmac.js";

let cachedClientToken = null;

function tokenEndpoint(shop) {
  return `https://${shop}/admin/oauth/access_token`;
}

export async function getShopifyAccessToken(shop = config.shopify.shop) {
  if (config.shopify.staticAccessToken) {
    return config.shopify.staticAccessToken;
  }

  if (!isValidShopDomain(shop)) {
    throw new Error(`Invalid Shopify shop domain: ${shop}`);
  }

  if (config.shopify.authMode === "client_credentials") {
    if (
      cachedClientToken &&
      cachedClientToken.shop === shop &&
      cachedClientToken.expiresAt > Date.now() + 5 * 60 * 1000
    ) {
      return cachedClientToken.accessToken;
    }

    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.shopify.clientId,
      client_secret: config.shopify.clientSecret,
    });

    const { data } = await axios.post(tokenEndpoint(shop), form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    });

    cachedClientToken = {
      shop,
      accessToken: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 86399) * 1000,
    };
    return cachedClientToken.accessToken;
  }

  const stored = await getOauthToken(shop);
  if (!stored?.accessToken) {
    throw new Error(
      `No OAuth token saved for ${shop}. Open /auth/install?shop=${encodeURIComponent(shop)} first.`
    );
  }

  if (!stored.expiresAt || stored.expiresAt > Date.now() + 5 * 60 * 1000) {
    return stored.accessToken;
  }

  if (!stored.refreshToken) {
    throw new Error("Stored Shopify OAuth token expired and has no refresh token. Reinstall the app.");
  }

  const form = new URLSearchParams({
    client_id: config.shopify.clientId,
    client_secret: config.shopify.clientSecret,
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
  });

  const { data } = await axios.post(tokenEndpoint(shop), form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });

  await saveOauthToken(shop, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || stored.refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + Number(data.expires_in) * 1000
      : null,
    refreshTokenExpiresAt: data.refresh_token_expires_in
      ? Date.now() + Number(data.refresh_token_expires_in) * 1000
      : stored.refreshTokenExpiresAt || null,
    scope: data.scope || stored.scope || "",
  });

  return data.access_token;
}

export async function buildInstallUrl(shop) {
  if (!isValidShopDomain(shop)) throw new Error("Invalid shop domain.");
  if (!config.publicBaseUrl) throw new Error("PUBLIC_BASE_URL is required for OAuth.");

  const state = crypto.randomBytes(24).toString("hex");
  await saveOauthState(state, shop);

  const params = new URLSearchParams({
    client_id: config.shopify.clientId,
    scope: config.shopify.scopes.join(","),
    redirect_uri: `${config.publicBaseUrl}/auth/callback`,
    state,
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

export async function handleOauthCallback(query) {
  const shop = String(query.shop || "");
  const state = String(query.state || "");
  const code = String(query.code || "");

  if (!isValidShopDomain(shop)) throw new Error("Invalid shop domain.");
  if (!verifyShopifyOauthQuery(query, config.shopify.clientSecret)) {
    throw new Error("OAuth HMAC verification failed.");
  }
  if (!(await consumeOauthState(state, shop))) {
    throw new Error("OAuth state is invalid or expired.");
  }
  if (!code) throw new Error("OAuth code missing.");

  const form = new URLSearchParams({
    client_id: config.shopify.clientId,
    client_secret: config.shopify.clientSecret,
    code,
  });

  const { data } = await axios.post(tokenEndpoint(shop), form, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    timeout: 15000,
  });

  await saveOauthToken(shop, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: data.expires_in
      ? Date.now() + Number(data.expires_in) * 1000
      : null,
    refreshTokenExpiresAt: data.refresh_token_expires_in
      ? Date.now() + Number(data.refresh_token_expires_in) * 1000
      : null,
    scope: data.scope || "",
  });

  return { shop, scope: data.scope || "" };
}
