import mongoose from "mongoose";

const { Schema } = mongoose;

const jobSchema = new Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    eventId: { type: String, index: true, sparse: true },
    type: { type: String, required: true },
    topic: { type: String, default: "" },
    shop: { type: String, default: "" },
    payload: { type: Schema.Types.Mixed, default: null },

    status: {
      type: String,
      enum: ["pending", "processing", "done", "failed"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    error: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

jobSchema.index({ eventId: 1 }, { unique: true, sparse: true });
jobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

const shipmentSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },
  },
  {
    strict: false,
    timestamps: true,
    minimize: false,
  }
);

const oauthStateSchema = new Schema(
  {
    state: { type: String, required: true, unique: true, index: true },
    shop: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 600 },
  },
  { versionKey: false }
);

const oauthTokenSchema = new Schema(
  {
    shop: { type: String, required: true, unique: true, index: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, default: null },
    expiresAt: { type: Number, default: null },
    refreshTokenExpiresAt: { type: Number, default: null },
    scope: { type: String, default: "" },
  },
  { timestamps: true, minimize: false }
);

export const Job =
  mongoose.models.Job || mongoose.model("Job", jobSchema);

export const Shipment =
  mongoose.models.Shipment || mongoose.model("Shipment", shipmentSchema);

export const OauthState =
  mongoose.models.OauthState || mongoose.model("OauthState", oauthStateSchema);

export const OauthToken =
  mongoose.models.OauthToken || mongoose.model("OauthToken", oauthTokenSchema);
