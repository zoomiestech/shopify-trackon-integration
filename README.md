# Shopify ↔ Trackon Integration — MongoDB Edition

Version 2 replaces the old `data/store.json` persistence with MongoDB Atlas.

## Main workflow

```text
Shopify order
   ↓
verified Shopify webhook
   ↓
MongoDB-backed job queue
   ↓
Trackon booking
   ↓
AWB persisted in MongoDB
   ↓
Shopify fulfillment + tracking number
   ↓
Trackon tracking polling
   ↓
latest status persisted + optional Shopify metafields
```

## Why MongoDB was added

Render Free has an ephemeral filesystem. A local JSON file can disappear after a deploy/restart. That is unsafe for courier booking because losing an AWB mapping can lead to duplicate bookings.

MongoDB now persists:

- jobs / webhook deduplication
- Shopify order → Trackon AWB mapping
- Trackon booking responses
- tracking status/history
- retry state
- OAuth state/tokens when OAuth mode is used

## Quick start

```bash
npm install
cp .env.example .env
```

Configure:

```env
MONGODB_URI=
MONGODB_DB=shopify_trackon

SHOPIFY_SHOP=
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_AUTH_MODE=client_credentials

PUBLIC_BASE_URL=https://YOUR-RENDER-URL
ADMIN_API_KEY=...

TRACKON_MOCK=true
BOOKING_TRIGGER=orders_create
SHOPIFY_NOTIFY_CUSTOMER=false
```

Test:

```bash
npm run test:mongodb
npm run test:shopify
npm run register-webhooks
npm run dev
```

## First Shopify test

Keep `TRACKON_MOCK=true`.

Create one Shopify order with:

- customer name
- shipping address
- pincode
- phone
- product with weight

Then inspect:

```http
GET /admin/jobs
x-admin-key: ADMIN_API_KEY
```

and:

```http
GET /admin/shipments
x-admin-key: ADMIN_API_KEY
```

Expected shipment data includes:

```text
orderId
orderName
awb
trackingStatus = BOOKED
shopifyFulfillmentId
```

The Shopify order should show a Trackon tracking number.

## Persistence test

After a successful mock order:

1. Confirm `/admin/shipments` contains it.
2. Redeploy or restart Render.
3. Call `/admin/shipments` again.

The same record must remain.

## Included fixes from the previous version

This build also includes:

1. The fulfillment-order GraphQL query no longer requests `assignedLocation.location.id`, so it does not require the unrelated `read_locations` permission.
2. `/admin/register-webhooks` safely handles an empty POST body with `req.body?.shop`.
3. MongoDB-backed AWB idempotency survives Render redeploys.
4. MongoDB-backed webhook/job deduplication survives Render redeploys.

## Trackon API

Keep mock mode enabled until MongoDB + Shopify fulfillment testing is fully green.

The supplied Trackon booking PDF documents the endpoint and fields but does not provide an authoritative full example body + exact Docket JSON key. The Trackon adapter therefore supports:

```env
TRACKON_BOOKING_BODY_MODE=json
```

or:

```env
TRACKON_BOOKING_BODY_MODE=form
```

and defensively extracts an AWB/Docket number.

Before production, verify one real test booking with Trackon.

## Useful commands

```bash
npm run test:mongodb
npm run test:shopify
npm run register-webhooks
npm run test:mock-booking
npm run test:tracking -- REAL_AWB
npm run dev
npm start
```

## Admin endpoints

All need:

```text
x-admin-key: ADMIN_API_KEY
```

Endpoints:

```text
GET  /admin/status
GET  /admin/shipments
GET  /admin/jobs
POST /admin/register-webhooks
POST /admin/retry-order/:orderId
POST /admin/run-tracking
```

## Files

```text
src/lib/mongodb.js         MongoDB connection
src/lib/models.js          Mongoose schemas
src/lib/store.js           persistent repository/job queue
src/services/shopify.js    Shopify GraphQL
src/services/trackon.js    Trackon adapter
src/workers/booking-worker.js
src/workers/tracking-worker.js
src/server.js
```

See `MONGODB_ATLAS_SETUP.md` for the Atlas setup walkthrough.
