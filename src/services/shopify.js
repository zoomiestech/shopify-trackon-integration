import axios from "axios";
import { config } from "../config.js";
import { getShopifyAccessToken } from "./shopify-auth.js";

export async function shopifyGraphql(query, variables = {}, shop = config.shopify.shop) {
  if (!shop) throw new Error("Shopify shop is not configured.");

  const token = await getShopifyAccessToken(shop);
  const url = `https://${shop}/admin/api/${config.shopify.apiVersion}/graphql.json`;

  const { data } = await axios.post(
    url,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      timeout: 20000,
    }
  );

  if (data.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

export async function testShopifyConnection(shop = config.shopify.shop) {
  const data = await shopifyGraphql(
    `query BridgeShopTest {
      shop {
        id
        name
        myshopifyDomain
        primaryDomain { url }
      }
    }`,
    {},
    shop
  );
  return data.shop;
}

export async function getFulfillmentOrders(
  orderGid,
  shop = config.shopify.shop
) {
  const data = await shopifyGraphql(
    `query BridgeFulfillmentOrders($id: ID!) {
      order(id: $id) {
        id
        name
        cancelledAt
        fulfillmentOrders(first: 20) {
          nodes {
            id
            status
            requestStatus
          }
        }
      }
    }`,
    { id: orderGid },
    shop
  );

  if (!data.order) {
    throw new Error(`Shopify order not found: ${orderGid}`);
  }

  return data.order;
}

function chooseFulfillmentOrder(nodes = []) {
  return nodes.find((fo) => !["CLOSED", "CANCELLED"].includes(fo.status));
}

export async function createShopifyFulfillment({
  orderGid,
  awb,
  shop = config.shopify.shop,
}) {
  const order = await getFulfillmentOrders(orderGid, shop);
  if (order.cancelledAt) {
    throw new Error("Shopify order is cancelled; fulfillment not created.");
  }

  const fo = chooseFulfillmentOrder(order.fulfillmentOrders?.nodes || []);
  if (!fo) {
    throw new Error(
      "No open Shopify fulfillment order found. The order may already be fulfilled, cancelled, on hold, or assigned differently."
    );
  }

  const mutation = `mutation BridgeFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        trackingInfo(first: 10) {
          company
          number
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const variables = {
    fulfillment: {
      lineItemsByFulfillmentOrder: [
        { fulfillmentOrderId: fo.id },
      ],
      notifyCustomer: config.shopify.notifyCustomer,
      trackingInfo: {
        company: "Trackon",
        number: String(awb),
      },
    },
  };

  const data = await shopifyGraphql(mutation, variables, shop);
  const result = data.fulfillmentCreate;

  if (result.userErrors?.length) {
    throw new Error(`Shopify fulfillment error: ${JSON.stringify(result.userErrors)}`);
  }
  if (!result.fulfillment?.id) {
    throw new Error("Shopify fulfillment was not created.");
  }
  return result.fulfillment;
}

export async function syncTrackingMetafields({
  orderGid,
  status,
  city,
  trackingCode,
  awb,
  shop = config.shopify.shop,
}) {
  if (!config.shopify.syncTrackingMetafields) return null;

  const mutation = `mutation BridgeTrackingMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { namespace key value }
      userErrors { field message code }
    }
  }`;

  const entries = [
    ["current_status", status || ""],
    ["current_city", city || ""],
    ["tracking_code", trackingCode || ""],
    ["awb", awb || ""],
    ["last_synced_at", new Date().toISOString()],
  ];

  const variables = {
    metafields: entries.map(([key, value]) => ({
      ownerId: orderGid,
      namespace: "trackon",
      key,
      type: "single_line_text_field",
      value: String(value).slice(0, 255),
    })),
  };

  const data = await shopifyGraphql(mutation, variables, shop);
  const errors = data.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(`Shopify metafield error: ${JSON.stringify(errors)}`);
  }
  return data.metafieldsSet?.metafields || [];
}

export async function registerWebhook(topic, uri, shop = config.shopify.shop) {
  const existingData = await shopifyGraphql(
    `query BridgeWebhookList {
      webhookSubscriptions(first: 100) {
        nodes { id topic uri }
      }
    }`,
    {},
    shop
  );

  const existing = (existingData.webhookSubscriptions?.nodes || []).find(
    (w) => w.topic === topic && w.uri === uri
  );
  if (existing) return { ...existing, alreadyExisted: true };

  const mutation = `mutation BridgeWebhookCreate(
    $topic: WebhookSubscriptionTopic!,
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(
      topic: $topic,
      webhookSubscription: $webhookSubscription
    ) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }`;

  const data = await shopifyGraphql(
    mutation,
    {
      topic,
      webhookSubscription: {
        uri,
        format: "JSON",
      },
    },
    shop
  );

  const result = data.webhookSubscriptionCreate;
  if (result.userErrors?.length) {
    throw new Error(`Webhook create error: ${JSON.stringify(result.userErrors)}`);
  }
  return { ...result.webhookSubscription, alreadyExisted: false };
}

export async function registerDefaultWebhooks(shop = config.shopify.shop) {
  if (!config.publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required before registering webhooks.");
  }

  const uri = `${config.publicBaseUrl}/webhooks/orders`;
  const topics = ["ORDERS_CREATE", "ORDERS_PAID", "ORDERS_CANCELLED"];
  const results = [];

  for (const topic of topics) {
    results.push(await registerWebhook(topic, uri, shop));
  }
  return results;
}
