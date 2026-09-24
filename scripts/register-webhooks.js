import { config } from "../src/config.js";
import { registerDefaultWebhooks } from "../src/services/shopify.js";

const shop = process.argv[2] || config.shopify.shop;

try {
  const result = await registerDefaultWebhooks(shop);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error?.response?.data || error);
  process.exit(1);
}
