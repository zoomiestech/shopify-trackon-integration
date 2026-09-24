import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

const filePath = path.resolve(config.dataFile);
let lock = Promise.resolve();

function initialStore() {
  return {
    version: 1,
    webhookEvents: {},
    jobs: [],
    shipments: {},
    oauthStates: {},
    oauthTokens: {},
  };
}

function ensureStore() {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initialStore(), null, 2));
  }
}

function readUnsafe() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { ...initialStore(), ...parsed };
  } catch {
    const broken = `${filePath}.broken-${Date.now()}`;
    try { fs.copyFileSync(filePath, broken); } catch {}
    const fresh = initialStore();
    fs.writeFileSync(filePath, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeUnsafe(data) {
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, filePath);
}

async function mutate(fn) {
  const current = lock;
  let release;
  lock = new Promise((resolve) => (release = resolve));
  await current;
  try {
    const db = readUnsafe();
    const result = await fn(db);
    writeUnsafe(db);
    return result;
  } finally {
    release();
  }
}

export async function recordWebhookAndEnqueue({ eventId, topic, shop, payload }) {
  return mutate((db) => {
    if (db.webhookEvents[eventId]) return { duplicate: true };

    db.webhookEvents[eventId] = {
      eventId,
      topic,
      shop,
      receivedAt: new Date().toISOString(),
    };

    db.jobs.push({
      id: crypto.randomUUID(),
      type: "shopify_webhook",
      topic,
      shop,
      payload,
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString(),
      error: null,
    });

    // Keep webhook event history bounded.
    const ids = Object.keys(db.webhookEvents);
    if (ids.length > 5000) {
      ids.slice(0, ids.length - 5000).forEach((id) => delete db.webhookEvents[id]);
    }

    return { duplicate: false };
  });
}

export async function enqueueJob(job) {
  return mutate((db) => {
    const row = {
      id: crypto.randomUUID(),
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString(),
      error: null,
      ...job,
    };
    db.jobs.push(row);
    return row;
  });
}

export async function leaseNextJob() {
  return mutate((db) => {
    const now = Date.now();
    const job = db.jobs.find(
      (j) =>
        j.status === "pending" &&
        (!j.nextAttemptAt || new Date(j.nextAttemptAt).getTime() <= now)
    );
    if (!job) return null;
    job.status = "processing";
    job.attempts = (job.attempts || 0) + 1;
    job.updatedAt = new Date().toISOString();
    return structuredClone(job);
  });
}

export async function completeJob(id) {
  return mutate((db) => {
    const job = db.jobs.find((j) => j.id === id);
    if (!job) return false;
    job.status = "done";
    job.error = null;
    job.updatedAt = new Date().toISOString();

    // Bound completed jobs.
    const completed = db.jobs.filter((j) => j.status === "done");
    if (completed.length > 1000) {
      const remove = new Set(completed.slice(0, completed.length - 1000).map((j) => j.id));
      db.jobs = db.jobs.filter((j) => !remove.has(j.id));
    }
    return true;
  });
}

export async function failJob(id, error, retryDelaySeconds = 60) {
  return mutate((db) => {
    const job = db.jobs.find((j) => j.id === id);
    if (!job) return false;

    const maxAttempts = 5;
    job.error = String(error?.message || error || "Unknown job error");
    job.updatedAt = new Date().toISOString();

    if ((job.attempts || 0) >= maxAttempts) {
      job.status = "failed";
    } else {
      job.status = "pending";
      job.nextAttemptAt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
    }
    return true;
  });
}

export function getShipment(orderId) {
  const db = readUnsafe();
  return db.shipments[String(orderId)] || null;
}

export async function upsertShipment(orderId, patch) {
  return mutate((db) => {
    const key = String(orderId);
    const old = db.shipments[key] || {
      orderId: key,
      createdAt: new Date().toISOString(),
    };
    db.shipments[key] = {
      ...old,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return structuredClone(db.shipments[key]);
  });
}

export function listShipments() {
  const db = readUnsafe();
  return Object.values(db.shipments).sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );
}

export function listJobs() {
  const db = readUnsafe();
  return [...db.jobs].sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );
}

export async function saveOauthState(state, shop) {
  return mutate((db) => {
    db.oauthStates[state] = {
      shop,
      createdAt: new Date().toISOString(),
    };
  });
}

export async function consumeOauthState(state, shop) {
  return mutate((db) => {
    const found = db.oauthStates[state];
    if (!found) return false;
    delete db.oauthStates[state];

    const ageMs = Date.now() - new Date(found.createdAt).getTime();
    return found.shop === shop && ageMs < 10 * 60 * 1000;
  });
}

export async function saveOauthToken(shop, tokenData) {
  return mutate((db) => {
    db.oauthTokens[shop] = {
      ...tokenData,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function getOauthToken(shop) {
  const db = readUnsafe();
  return db.oauthTokens[shop] || null;
}
