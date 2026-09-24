import { config } from "../src/config.js";
import { createTrackonBooking } from "../src/services/trackon.js";

if (!config.trackon.mock) {
  console.error("Refusing to run: TRACKON_MOCK must be true for this script.");
  process.exit(1);
}

const sampleOrder = {
  id: 1234567890,
  name: "#TEST1001",
  email: "test@example.com",
  current_total_price: "1999.00",
  shipping_address: {
    name: "Test Customer",
    address1: "123 Test Street",
    address2: "",
    city: "Pune",
    zip: "411001",
    phone: "9999999999"
  },
  line_items: [
    { title: "Test Product", quantity: 1, grams: 2500 }
  ]
};

const result = await createTrackonBooking(sampleOrder);
console.log(JSON.stringify(result, null, 2));
