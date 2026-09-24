import crypto from "node:crypto";
import { Job, Shipment, OauthState, OauthToken } from "./models.js";

function plain(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  if (obj._id) obj._id = String(obj._id);
  delete obj.__v;
  return obj;
}

export async function recordWebhookAndEnqueue({
  eventId,
  topic,
  shop,
  payload,
}) {
  try {
    await Job.create({
      jobId: crypto.randomUUID(),
      eventId,
      type: "shopify_webhook",
      topic,
      shop,
      payload,
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      error: null,
    });

    return { duplicate: false };
  } catch (error) {
    if (error?.code === 11000) {
      return { duplicate: true };
    }
    throw error;
  }
}

export async function enqueueJob(job) {
  const row = await Job.create({
    jobId: crypto.randomUUID(),
    status: "pending",
    attempts: 0,
    nextAttemptAt: new Date(),
    error: null,
    ...job,
  });

  return plain(row);
}

export async function leaseNextJob() {
  const now = new Date();

  const job = await Job.findOneAndUpdate(
    {
      status: "pending",
      $or: [
        { nextAttemptAt: { $exists: false } },
        { nextAttemptAt: null },
        { nextAttemptAt: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "processing",
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      sort: { createdAt: 1 },
      new: true,
    }
  );

  return plain(job);
}

export async function completeJob(id) {
  const result = await Job.updateOne(
    { jobId: id },
    {
      $set: {
        status: "done",
        error: null,
      },
    }
  );

  return result.matchedCount > 0;
}

export async function failJob(id, error, retryDelaySeconds = 60) {
  const job = await Job.findOne({ jobId: id });
  if (!job) return false;

  const maxAttempts = 5;
  job.error = String(error?.message || error || "Unknown job error");

  if ((job.attempts || 0) >= maxAttempts) {
    job.status = "failed";
  } else {
    job.status = "pending";
    job.nextAttemptAt = new Date(Date.now() + retryDelaySeconds * 1000);
  }

  await job.save();
  return true;
}

export async function getShipment(orderId) {
  return plain(
    await Shipment.findOne({ orderId: String(orderId) }).lean()
  );
}

export async function upsertShipment(orderId, patch) {
  const key = String(orderId);

  const doc = await Shipment.findOneAndUpdate(
    { orderId: key },
    {
      $set: {
        ...patch,
        orderId: key,
      },
      $setOnInsert: {
        orderId: key,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  return plain(doc);
}

export async function listShipments() {
  const docs = await Shipment.find({})
    .sort({ updatedAt: -1 })
    .lean();

  return docs.map(plain);
}

export async function listJobs(limit = 200) {
  const docs = await Job.find({})
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return docs.map((doc) => {
    const out = plain(doc);
    // Preserve the old API field name used by the server/UI.
    out.id = out.jobId;
    return out;
  });
}

export async function saveOauthState(state, shop) {
  await OauthState.findOneAndUpdate(
    { state },
    {
      $set: {
        state,
        shop,
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

export async function consumeOauthState(state, shop) {
  const found = await OauthState.findOneAndDelete({ state }).lean();
  if (!found) return false;

  const ageMs = Date.now() - new Date(found.createdAt).getTime();
  return found.shop === shop && ageMs < 10 * 60 * 1000;
}

export async function saveOauthToken(shop, tokenData) {
  await OauthToken.findOneAndUpdate(
    { shop },
    {
      $set: {
        shop,
        ...tokenData,
      },
    },
    {
      upsert: true,
      new: true,
    }
  );
}

export async function getOauthToken(shop) {
  return plain(await OauthToken.findOne({ shop }).lean());
}

export async function databaseCounts() {
  const [shipments, jobs] = await Promise.all([
    Shipment.countDocuments(),
    Job.countDocuments(),
  ]);

  return { shipments, jobs };
}
