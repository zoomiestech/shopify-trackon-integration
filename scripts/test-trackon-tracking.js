import { trackTrackonAwb, normalizeTrackonTracking } from "../src/services/trackon.js";

const awb = process.argv[2];

if (!awb) {
  console.error("Usage: npm run test:tracking -- <AWB_NUMBER>");
  process.exit(1);
}

try {
  const raw = await trackTrackonAwb(awb);
  console.log("Raw response:");
  console.log(JSON.stringify(raw, null, 2));
  console.log("\nNormalized:");
  console.log(JSON.stringify(normalizeTrackonTracking(raw), null, 2));
} catch (error) {
  console.error(error?.response?.data || error);
  process.exit(1);
}
