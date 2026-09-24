import mongoose from "mongoose";
import { config } from "../config.js";

mongoose.set("strictQuery", true);

export async function connectMongo() {
  if (!config.mongodb.uri) {
    throw new Error("MONGODB_URI is required.");
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  await mongoose.connect(config.mongodb.uri, {
    dbName: config.mongodb.dbName,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    maxPoolSize: 10,
  });

  console.log(
    `MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`
  );

  return mongoose.connection;
}

export function mongoStatus() {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  return {
    readyState: mongoose.connection.readyState,
    state: states[mongoose.connection.readyState] || "unknown",
    host: mongoose.connection.host || null,
    database: mongoose.connection.name || config.mongodb.dbName,
  };
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}
