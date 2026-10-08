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

// Codes where the request may have reached Trackon but no answer came back.
// Trackon may well have booked it (order #8375 was booked although the call
// timed out), so retrying risks a second docket.
const NO_REPLY_CODES = new Set(["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "EPIPE"]);

export function bookingNoReplyError(error, refNo) {
  if (!NO_REPLY_CODES.has(error?.code) || error.response) {
    return null;
  }

  const reason = String(error.message || error.code);
  const result = new Error(
    `Trackon did not answer in time (${reason}). ` +
      `It may already be booked: check the Trackon portal for ref ${refNo}`
  );
  result.permanent = true;
  result.possiblyBooked = true;
  result.code = error.code;
  return result;
}
