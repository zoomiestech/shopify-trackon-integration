# Shopify ↔ Trackon Courier Bridge

A small Node.js service that connects Shopify orders to the Trackon Courier APIs supplied with this project.

## What it does

1. Receives Shopify order webhooks.
2. Verifies Shopify's webhook HMAC signature.
3. Deduplicates webhook deliveries.
4. Maps the Shopify order to Trackon's Booking Pickup Data Push fields.
5. Calls Trackon's booking endpoint and extracts the returned Docket/AWB number.
6. Saves the AWB locally.
7. Creates a Shopify fulfillment with `company: Trackon` and the AWB number.
8. Polls Trackon's customer tracking API.
9. Saves Trackon's latest status/history locally.
10. Optionally mirrors the latest Trackon status to Shopify order metafields in the `trackon` namespace.
11. Handles retries so a Shopify/API failure after Trackon booking does **not** create a second AWB.
12. Provides a `TRACKON_MOCK=true` mode so the Shopify side can be tested before using Trackon's production API.

---

# Important Trackon documentation caveat

The supplied Trackon **Booking Pickup Data Push API** PDF documents:

- the POST endpoint,
- request fields,
- authentication fields,
- data types,
- service types,
- and that a Docket No. is returned,

but it does **not** include a complete, copy-paste sample POST request body or a definitive JSON response schema/key for the Docket No.

For that reason this bridge:

- initially sends the documented fields as a top-level JSON object,
- can switch to URL-encoded form mode with `TRACKON_BOOKING_BODY_MODE=form`,
- and has a defensive AWB extractor that looks for common AWB/Docket fields and 10–15 digit values.

Before switching `TRACKON_MOCK=false`, run one Trackon test booking with credentials supplied by Trackon and inspect the saved response. If Trackon provides a different request envelope, only `src/services/trackon.js` needs to be adjusted.

---

# 1. Requirements

- Node.js 20+
- A Shopify store
- A Shopify app created in the Shopify Dev Dashboard
- Trackon test/production credentials:
  - Appkey
  - userId
  - password
- Trackon account configuration:
  - CustomerCode if applicable
  - PickupCustCode if Trackon created one
  - TypeOfService
  - ServiceType
- An HTTPS public URL for webhook delivery

---

# 2. Install locally

Unzip the project, then:

```bash
npm install
cp .env.example .env
```

Edit `.env`.

For the very first run keep:

```env
TRACKON_MOCK=true
```

Start:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/health
```

You should get JSON with `"ok": true`.

Test the mock Trackon mapper:

```bash
npm run test:mock-booking
```

---

# 3. Create the Shopify app

Use Shopify's **Dev Dashboard**.

Create an app and add these Admin API scopes:

```text
read_orders
write_orders
read_merchant_managed_fulfillment_orders
write_merchant_managed_fulfillment_orders
```

The app reads customer shipping details to send an order to the courier, so configure Shopify's protected customer-data access as required for your app/store.

Use Shopify Admin GraphQL API version:

```text
2026-07
```

## Authentication option A: client credentials

Use this for a server-side integration acting on a store in the same Shopify organization as the Dev Dashboard app.

`.env`:

```env
SHOPIFY_AUTH_MODE=client_credentials
SHOPIFY_SHOP=your-store.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
```

Install the app on the store from the Dev Dashboard.

Then test:

```bash
npm run test:shopify
```

## Authentication option B: OAuth

Use this when installing the standalone/API-only app onto a merchant store where client credentials aren't available.

Set:

```env
SHOPIFY_AUTH_MODE=oauth
SHOPIFY_SHOP=your-store.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
PUBLIC_BASE_URL=https://your-public-app-url.example.com
```

In Shopify Dev Dashboard, add the allowed redirect URL:

```text
https://your-public-app-url.example.com/auth/callback
```

Deploy/start the app, then visit:

```text
https://your-public-app-url.example.com/auth/install?shop=your-store.myshopify.com
```

Approve the app. The offline token is stored in `DATA_FILE`.

For production OAuth deployments, **use a persistent disk** for the `data` directory.

---

# 4. Expose/deploy the backend

Shopify webhooks require HTTPS.

Recommended production shape:

```text
Shopify
  ↓ HTTPS webhook
Node bridge
  ↓
Trackon API

Node bridge
  ↓
Shopify Admin GraphQL API
```

The included `Dockerfile` works on container hosts.

The included `render.yaml` also shows a Render persistent disk mounted at `/app/data`.

You can use Railway, Render, ECS/Fargate, Fly.io, a VPS, etc.

Set:

```env
PUBLIC_BASE_URL=https://YOUR-LIVE-DOMAIN
```

Do not include a trailing slash.

---

# 5. Register Shopify webhooks

Once your backend has a live HTTPS URL, register:

- `ORDERS_CREATE`
- `ORDERS_PAID`
- `ORDERS_CANCELLED`

The project uses the same endpoint for all three:

```text
POST /webhooks/orders
```

Run from the deployed environment or locally with the same production `.env`:

```bash
npm run register-webhooks
```

Or call:

```http
POST /admin/register-webhooks
x-admin-key: YOUR_ADMIN_API_KEY
Content-Type: application/json

{}
```

The registration script is idempotent for the same topic + URL.

---

# 6. Choose when Trackon booking happens

`.env`:

```env
BOOKING_TRIGGER=orders_create
```

or:

```env
BOOKING_TRIGGER=orders_paid
```

Recommended choices:

- prepaid-only workflow: `orders_paid`
- COD / immediately confirmed fulfillment workflow: `orders_create`

The bridge still listens to both topics, but only the configured trigger creates a Trackon booking.

---

# 7. Test Shopify without hitting Trackon

Keep:

```env
TRACKON_MOCK=true
```

Create a Shopify test order with:

- shipping name
- address line 1
- city
- pincode
- phone number
- at least one item

Expected sequence:

```text
Shopify order
  ↓
/webhooks/orders
  ↓
HMAC verified
  ↓
job queued
  ↓
mock 12-digit AWB created
  ↓
AWB saved
  ↓
Shopify fulfillment created with Trackon tracking number
```

Check:

```http
GET /admin/shipments
x-admin-key: YOUR_ADMIN_API_KEY
```

Also check the order in Shopify Admin. A fulfillment should exist with:

```text
Carrier: Trackon
Tracking number: mock AWB
```

If `SHOPIFY_NOTIFY_CUSTOMER=false`, Shopify will not send the fulfillment email during this test.

---

# 8. Verify webhook delivery

Shopify webhook requests are accepted only if `X-Shopify-Hmac-SHA256` matches the HMAC of the **raw request body** using the app client secret.

The code intentionally mounts `express.raw()` on `/webhooks/orders` before `express.json()`.

Duplicate Shopify deliveries are deduplicated using `X-Shopify-Event-Id` / `X-Shopify-Webhook-Id`.

---

# 9. Configure Trackon

From the supplied Booking API document the integration uses:

```text
POST
https://api.trackon.in/CrmApi/Crm/UploadPickupRequestWithoutDockNo
```

Authentication fields:

```text
Appkey
userId
password
```

Main mapped fields include:

```text
SerialNo
RefNo
ActionType
CustomerCode
ClientName
AddressLine1
AddressLine2
City
PinCode
MobileNo
Email
DocType
TypeOfService
Weight
InvoiceValue
NoOfPieces
ItemName
Remark
PickupCustCode
PickupCustName
PickupAddr
PickupCity
PickupState
PickupPincode
PickupPhone
ServiceType
```

If Trackon supplied a vendor pickup customer code:

```env
TRACKON_PICKUP_CUSTOMER_CODE=...
```

Otherwise configure:

```env
PICKUP_NAME=
PICKUP_ADDRESS=
PICKUP_CITY=
PICKUP_STATE=
PICKUP_PINCODE=
PICKUP_PHONE=
```

Confirm these account-specific values with Trackon:

```env
TRACKON_CUSTOMER_CODE=
TRACKON_TYPE_OF_SERVICE=
TRACKON_SERVICE_TYPE=Parcel
```

The supplied document lists these ServiceType values:

```text
Parcel
Standard
Prime
Roadx
Tecex
Vtexp
Smexp
```

Do not guess which one belongs to your account. Use Trackon's assigned service/AWB series.

---

# 10. First real Trackon test

Fill:

```env
TRACKON_APP_KEY=
TRACKON_USER_ID=
TRACKON_PASSWORD=
```

Keep customer notifications disabled:

```env
SHOPIFY_NOTIFY_CUSTOMER=false
```

Then switch:

```env
TRACKON_MOCK=false
```

Create **one controlled Shopify test order** to an address you own/control.

Watch application logs.

If booking succeeds, `/admin/shipments` will show:

```text
awb
trackonBookingResponse
shopifyFulfillmentId
```

The raw booking response is stored in `data/store.json`.

If Trackon rejects the body:

1. ask Trackon whether the endpoint expects JSON or form-urlencoded;
2. if form-urlencoded, set:

```env
TRACKON_BOOKING_BODY_MODE=form
```

3. retry the order from:

```http
POST /admin/retry-order/SHOPIFY_NUMERIC_ORDER_ID
x-admin-key: YOUR_ADMIN_API_KEY
```

The bridge will not create another AWB if one is already saved.

---

# 11. Test Trackon tracking separately

The supplied newer tracking PDF documents:

```text
GET
https://api.trackon.in/CrmApi/t1/AWBTrackingCustomer
```

Run:

```bash
npm run test:tracking -- YOUR_REAL_AWB
```

The project passes:

```text
AWBNo
AppKey
userID
Password
```

It normalizes:

```text
summaryTrack
lstDetails
ResponseStatus
```

including:

```text
CURRENT_STATUS
CURRENT_CITY
TRACKING_CODE
EVENTDATE
EVENTTIME
NDR_REASON
```

---

# 12. Tracking worker

Active shipments are polled according to:

```env
TRACKING_POLL_MINUTES=60
```

Minimum effective interval in the app is 5 minutes.

You can also trigger a run manually:

```http
POST /admin/run-tracking
x-admin-key: YOUR_ADMIN_API_KEY
```

Latest values are stored locally.

When enabled:

```env
SHOPIFY_SYNC_TRACKING_METAFIELDS=true
```

the following Shopify order metafields are updated:

```text
trackon.current_status
trackon.current_city
trackon.tracking_code
trackon.awb
trackon.last_synced_at
```

---

# 13. Shopify cancellations

The bridge receives `ORDERS_CANCELLED` and records the cancellation.

It intentionally does **not** call Trackon to cancel an AWB, because the supplied Trackon API documents do not specify a shipment-cancellation API.

If Trackon gives you a cancellation API later, add it to `src/services/trackon.js` and the cancellation worker path.

---

# 14. Reverse pickup

The supplied Trackon booking document lists:

```text
ActionType = Rpickup
```

for reverse pickup requests.

This package does not automatically connect Shopify Returns to `Rpickup`, because the business rules for return approval, pickup location, AWB handling and refund timing were not provided.

Once forward booking is stable, reverse pickup can be added as a second phase.

---

# 15. Admin/debug endpoints

All `/admin/*` routes require:

```text
x-admin-key: ADMIN_API_KEY
```

Available endpoints:

```text
GET  /admin/status
POST /admin/register-webhooks
GET  /admin/shipments
GET  /admin/jobs
POST /admin/retry-order/:orderId
POST /admin/run-tracking
```

Never expose `ADMIN_API_KEY` in storefront JavaScript.

---

# 16. Production checklist

Before switching fully live:

- [ ] `TRACKON_MOCK=false`
- [ ] Real Trackon credentials installed as environment variables
- [ ] Trackon test booking verified
- [ ] Correct `TypeOfService`
- [ ] Correct `ServiceType`
- [ ] Correct pickup code/address
- [ ] Weight unit confirmed with Trackon
- [ ] Shopify protected customer data configured
- [ ] Shopify scopes approved
- [ ] Webhooks registered to production URL
- [ ] HMAC verification working
- [ ] Duplicate webhook test passed
- [ ] Trackon timeout/retry test passed
- [ ] Shopify fulfillment retry test passed
- [ ] Persistent `/data` volume configured
- [ ] `ADMIN_API_KEY` rotated to a strong secret
- [ ] Customer notification preference confirmed
- [ ] COD/prepaid booking trigger confirmed
- [ ] Order-cancellation SOP agreed with operations
- [ ] Trackon API rate limits confirmed before aggressive tracking polling

---

# 17. Where to change code

Trackon request/response adapter:

```text
src/services/trackon.js
```

Shopify GraphQL/auth:

```text
src/services/shopify.js
src/services/shopify-auth.js
```

Booking workflow:

```text
src/workers/booking-worker.js
```

Tracking workflow:

```text
src/workers/tracking-worker.js
```

Webhook/API server:

```text
src/server.js
```

---

# 18. Security

Never put these values in Shopify Liquid, theme JavaScript, Git, screenshots, or browser code:

```text
SHOPIFY_CLIENT_SECRET
SHOPIFY_ACCESS_TOKEN
TRACKON_APP_KEY
TRACKON_USER_ID
TRACKON_PASSWORD
ADMIN_API_KEY
```

Keep them in your deployment platform's secret/environment-variable settings.
