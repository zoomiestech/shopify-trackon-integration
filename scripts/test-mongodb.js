import mongoose from "mongoose";
import { connectMongo, mongoStatus } from "../src/lib/mongodb.js";
import { databaseCounts } from "../src/lib/store.js";

try {
  await connectMongo();

  console.log("MongoDB connection OK:");
  console.log(JSON.stringify(mongoStatus(), null, 2));

  console.log("\nCurrent counts:");
  console.log(JSON.stringify(await databaseCounts(), null, 2));

  await mongoose.disconnect();
  process.exit(0);
} catch (error) {
  console.error("MongoDB connection failed:");
  console.error(error);
  process.exit(1);
}
