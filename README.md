# Shopify ↔ Trackon Integration — MongoDB Edition

Version 2 replaces the old `data/store.json` persistence with MongoDB Atlas.

## Main workflow

```text
Shopify order
   ↓
staff add a booking tag in Shopify Admin (see "Choosing Air or SF" below)
   ↓
verified Shopify webhook (orders/create or orders/updated)
   ↓
MongoDB-backed job queue
   ↓
Trackon booking
   ↓
AWB persisted in MongoDB (Shopify order stays unfulfilled)
   ↓
trackon.awb metafield + `trackon-booked` tag written to the Shopify order
   ↓
Trackon tracking polling
   ↓
Trackon PRSS (pickup successful)
   ↓
Shopify fulfillment + tracking number + customer email
   ↓
Out for delivery / delivered events + optional Shopify metafields
```

Orders without the tag are ignored completely: no booking, no fulfillment
and nothing stored in MongoDB. Each order is booked at most once; removing
or re-adding the tag after booking does nothing, and nothing is cancelled
at Trackon. The tag name is set by `TRACKON_BOOKING_TAG`.

## Choosing Air or SF

Trackon's `TypeOfService` is chosen per order by the booking tag, not by an
environment variable:

| Tag | TypeOfService |
|---|---|
| `book-trackon-air` | `Air` |
| `book-trackon-sf` | `SF` (surface) |
| `book-trackon` | `SF` (surface) |

An order with both `book-trackon-air` and `book-trackon-sf` is not booked:
it gets the `trackon-booking-failed` tag at once and the reason in
`trackon.history`. Remove one of the two tags, then `trackon-booking-failed`,
to book it. The mode used is shown in the history's booking line and saved
on the shipment as `typeOfService`.

`TRACKON_SERVICE_TYPE` stays an environment variable, because it must match
the AWB number series Trackon issued (10 = Standard, 50 = Parcel, ...).

## What staff see in Shopify

Shopify does not let apps write timeline comments, so each step is
logged in the `trackon.history` order metafield (create the definition as
**Multi-line text**), one line per step in India time: the booking, every
Trackon scan with its reason, and the fulfillment.

The service also manages these tags, so staff can filter the order list:

| Tag | Meaning | Cleared when |
|---|---|---|
| `trackon-booked` | AWB created | never |
| `trackon-booking-failed` | every booking attempt failed; reason in the history | staff fix the order and remove the tag, which books it again |
| `trackon-pickup-failed` | latest Trackon status is PRSN | Trackon moves on |
| `trackon-delivery-failed` | latest Trackon status is DNUB / DNUF / DNUA | Trackon moves on |
| `trackon-rto` | the shipment is returning to origin | never |

Each failed delivery attempt is also sent to Shopify as an
"Attempted delivery" fulfillment event with Trackon's reason.

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
TRACKON_BOOKING_TAG=book-trackon
SHOPIFY_NOTIFY_CUSTOMER=false
```

Test:

```bash
npm test
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

Then add the `book-trackon-sf` (or `book-trackon-air`) tag to the order in
Shopify Admin, and inspect:

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
trackingStatus = AWB_CREATED
dispatchState = WAITING_FOR_PICKUP
```

The Shopify order gets the `trackon-booked` tag and the `trackon.awb`
metafield straight away. To see the metafield on the order page, add an
order metafield definition for `trackon.awb` (Settings > Custom data >
Orders). If this Shopify update fails, the booking still stands and the
error is saved as `shopifyBookingPublishError` on the shipment.

The order stays unfulfilled until Trackon reports PRSS. Then it is
fulfilled with the Trackon tracking number and the customer is emailed.

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
