// Trackon answers a refused booking with Status false and its reason in
// Message, for example "Customer Code is empty....!" (ErrorCode 505).
export function bookingRejectionMessage(data) {
  if (!data || typeof data !== "object" || data.Status !== false) {
    return null;
  }

  const code = data.ErrorCode ?? "no error code";
  const message = String(data.Message || "").trim() || "no message";

  return `Trackon rejected booking (${code}): ${message}`;
}

// Retrying cannot change Trackon's answer, so the error is permanent: the
// order is reported to staff at once instead of after the retries.
export function bookingRejectionError(data) {
  const message = bookingRejectionMessage(data);
  if (!message) return null;

  const error = new Error(message);
  error.permanent = true;
  error.trackonResponse = data;
  return error;
}
