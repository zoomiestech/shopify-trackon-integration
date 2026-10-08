// What may be logged or stored about an error. An axios error carries the
// whole request: Trackon credentials in the body or query string, the
// Shopify access token in a header, and the customer's name, phone, email
// and address. None of that may reach the logs, so only these fields pass.

function stripQuery(url) {
  return String(url).split("?")[0];
}

export function safeError(error) {
  if (error === undefined || error === null) {
    return { message: "Unknown error" };
  }

  if (typeof error !== "object") {
    return { message: String(error) };
  }

  const safe = { message: String(error.message || "Unknown error") };

  if (error.code) safe.code = error.code;
  if (error.config?.method) safe.method = String(error.config.method).toUpperCase();
  if (error.config?.url) safe.url = stripQuery(error.config.url);
  if (error.response?.status) safe.status = error.response.status;
  if (error.response?.data !== undefined) safe.response = error.response.data;
  if (error.trackonResponse) safe.trackonResponse = error.trackonResponse;

  return safe;
}
