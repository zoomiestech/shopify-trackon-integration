import { test } from "node:test";
import assert from "node:assert/strict";
import { safeError } from "../src/lib/safe-error.js";

// Shaped like the axios timeout in the Render logs: the request body holds
// Trackon credentials and customer details.
function axiosTimeout() {
  const error = new Error("timeout of 15000ms exceeded");
  error.isAxiosError = true;
  error.code = "ECONNABORTED";
  error.config = {
    url: "https://api.trackon.in/CrmApi/Crm/UploadPickupRequestWithoutDockNo",
    method: "post",
    data: '{"Appkey":"SECRET-KEY","userId":"U1","password":"SECRET-PW","ClientName":"A Customer","MobileNo":"9999999999"}',
    params: { AppKey: "SECRET-KEY", Password: "SECRET-PW" },
    headers: { "X-Shopify-Access-Token": "shpat_SECRET" },
  };
  error.request = { _header: "POST /CrmApi ..." };
  return error;
}

test("an axios error keeps only message, code, method and URL", () => {
  assert.deepEqual(safeError(axiosTimeout()), {
    message: "timeout of 15000ms exceeded",
    code: "ECONNABORTED",
    method: "POST",
    url: "https://api.trackon.in/CrmApi/Crm/UploadPickupRequestWithoutDockNo",
  });
});

test("no credential or customer detail survives, even serialised", () => {
  const text = JSON.stringify(safeError(axiosTimeout()));
  for (const secret of ["SECRET-KEY", "SECRET-PW", "shpat_SECRET", "A Customer", "9999999999", "password", "Appkey"]) {
    assert.equal(text.includes(secret), false, `leaked ${secret}`);
  }
});

test("an HTTP error keeps the status and the reply body", () => {
  const error = axiosTimeout();
  error.message = "Request failed with status code 502";
  error.code = "ERR_BAD_RESPONSE";
  error.response = { status: 502, data: { Message: "Bad gateway" } };

  const safe = safeError(error);
  assert.equal(safe.status, 502);
  assert.deepEqual(safe.response, { Message: "Bad gateway" });
});

test("query strings are cut from the URL, because Trackon tracking puts credentials there", () => {
  const error = axiosTimeout();
  error.config.url = "https://api.trackon.in/CrmApi/t1/AWBTrackingCustomer?AppKey=SECRET-KEY&Password=SECRET-PW";
  assert.equal(safeError(error).url, "https://api.trackon.in/CrmApi/t1/AWBTrackingCustomer");
});

test("a Trackon rejection keeps Trackon's reply", () => {
  const error = new Error("Trackon rejected booking (501): Pincode NoServiceable");
  error.trackonResponse = { Status: false, ErrorCode: 501 };
  assert.deepEqual(safeError(error), {
    message: "Trackon rejected booking (501): Pincode NoServiceable",
    trackonResponse: { Status: false, ErrorCode: 501 },
  });
});

test("plain errors and non-errors are handled", () => {
  assert.deepEqual(safeError(new Error("boom")), { message: "boom" });
  assert.deepEqual(safeError("text"), { message: "text" });
  assert.deepEqual(safeError(undefined), { message: "Unknown error" });
});
