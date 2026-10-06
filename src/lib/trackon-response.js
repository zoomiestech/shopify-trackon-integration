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
