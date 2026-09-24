import { config } from "../src/config.js";
import { testShopifyConnection } from "../src/services/shopify.js";

const shop = process.argv[2] || config.shopify.shop;

try {
  const result = await testShopifyConnection(shop);
  console.log("Shopify connection OK:");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Shopify connection failed:");
  console.error(error?.response?.data || error);
  process.exit(1);
}
