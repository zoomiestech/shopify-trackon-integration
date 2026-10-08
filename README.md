# Shopify ↔ Trackon Integration — MongoDB Edition

Version 2 replaces the old `data/store.json` persistence with MongoDB Atlas.

## Main workflow

```text
Shopify order
   ↓
staff add a booking tag in Shopify Admin (see "Choosing Air or Surface" below)
   ↓
verified Shopify webhook (orders/create or orders/updated)
   ↓
MongoDB-backed job queue
   ↓
Trackon booking
   ↓
AWB persisted in MongoDB
   ↓
trackon.awb metafield + `trackon-booked` tag written to the Shopify order
   ↓
Shopify fulfillment + tracking number + customer shipping email
   ↓
Trackon tracking polling (every 15 minutes)
   ↓
Out for delivery / attempted delivery / delivered events + metafields
```

Orders without the tag are ignored completely: no booking, no fulfillment
and nothing stored in MongoDB. Each order is booked at most once; removing
or re-adding the tag after booking does nothing, and nothing is cancelled
at Trackon. The tag name is set by `TRACKON_BOOKING_TAG`.

## Choosing Air or Surface

Trackon's `TypeOfService` is chosen per order by the booking tag, not by an
environment variable:

| Tag | TypeOfService |
|---|---|
| `book-trackon-air` | `Air` |
| `book-trackon-sf` | `Surface` |
| `book-trackon` | `Surface` |

Trackon's live API accepts only `Air` or `Surface` (it rejects `SF` with
error 506, although its booking PDF lists "Air/SF/PT").

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
| `trackon-booking-failed` | the booking failed; reason in the history (see below) | staff fix the order and remove the tag, which books it again |
| `trackon-pickup-failed` | latest Trackon status is PRSN | Trackon moves on |
| `trackon-delivery-failed` | latest Trackon status is DNUB / DNUF / DNUA | Trackon moves on |
| `trackon-rto` | the shipment is returning to origin | never |

Each failed delivery attempt is also sent to Shopify as an
"Attempted delivery" fulfillment event with Trackon's reason.

When a booking fails:

| Failure | Attempts | `trackon-booking-failed` added |
|---|---|---|
| Trackon rejects it (`Status: false`, e.g. pincode not serviceable) | 1 | within seconds |
| Both the `-air` and `-sf` tags on the order | 1 | within seconds |
| Trackon does not answer (timeout, connection dropped) | 1 | as soon as the wait runs out |
| Trackon unreachable (connection refused, DNS) or Trackon 5xx | 3 (retries after 1 and 2 minutes) | about 3 minutes |

A timeout is never retried: the request reached Trackon, which may have
booked it anyway (order #8375 was booked although the call timed out).
Raise `TRACKON_TIMEOUT_MS` (in milliseconds) if Trackon is often slow.

### When Trackon booked but did not confirm

The history says "Trackon did not answer in time … check the Trackon
portal for ref #…". Do **not** remove `trackon-booking-failed`: that books
it again. Find the docket in the Trackon portal (cancel any duplicates),
then attach its AWB:

```bash
curl -X POST "https://SERVICE-URL/admin/attach-awb/<orderId>" \
  -H "x-admin-key: KEY" -H "Content-Type: application/json" \
  -d '{"awb": "500664884543", "typeOfService": "Surface"}'
```

This finishes the order exactly like a normal booking: AWB saved,
`trackon.awb` and history written, `trackon-booked` added,
`trackon-booking-failed` removed, the order fulfilled and the customer
emailed, then tracked. `typeOfService` is optional and only recorded. It
refuses an AWB that is not 10 to 15 digits, an order the service never
tried to book, an order that already has an AWB, and a cancelled order.

Errors are logged without the request: no Trackon credentials, Shopify
token or customer details reach the logs.

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
dispatchState = FULFILLED
shopifyFulfillmentId
```

The Shopify order gets the `trackon-booked` tag and the `trackon.awb`
metafield straight away. To see the metafield on the order page, add an
order metafield definition for `trackon.awb` (Settings > Custom data >
Orders). If this Shopify update fails, the booking still stands and the
error is saved as `shopifyBookingPublishError` on the shipment.

Straight after that, the order is fulfilled with the Trackon tracking
number and link, and the customer gets Shopify's shipping email. Pickup is
not waited for: pickup scans only appear in `trackon.history`. If the
fulfillment call fails, the error is saved as `shopifyFulfillmentError`
and the next tracking poll retries it; the booking is never repeated.

If an order is cancelled after booking, staff must cancel the fulfillment
in Shopify and the AWB with Trackon by hand.

## Testing every tracking step in development

With `TRACKON_MOCK=true`, fake Trackon scans can be added to a booked order.
Mock tracking returns them in Trackon's live response shape, so the real
tracking code handles them exactly as it would a courier's scans. The
endpoint returns 404 when `TRACKON_MOCK` is not `true`.

```bash
curl -X POST "https://DEV-URL/admin/mock-scan/<orderId>?run=true" \
  -H "x-admin-key: KEY" -H "Content-Type: application/json" \
  -d '{"code": "DRSG"}'
```

`<orderId>` is the number in the Shopify order URL. `?run=true` polls at
once and returns this order's result. Optional fields: `status` (the
reason text, e.g. `"UNDELIVERED DUE TO DOOR LOCKED"`) and `city`. An
unknown code is refused with the list of valid codes.

Use your own email as the customer: real Shopify emails are sent.

| Order | Send, in turn | Expect in Shopify |
|---|---|---|
| A, tagged `book-trackon-sf` | nothing | fulfilled with the AWB at once, shipping email |
| | `PRSN` | `trackon-pickup-failed` tag, history line |
| | `PRSS` | history line, pickup tag cleared |
| | `DRSG` | "Out for delivery" event |
| | `DNUB` with a `status` | "Attempted delivery" event, `trackon-delivery-failed` tag |
| | `DDUB` | "Delivered" event, tag cleared, polling stops |
| B, tagged `book-trackon-air` | `PRSS`, then `RSET` | `trackon-rto` tag |
| | `RHOD` | polling stops |
| C, tagged `book-trackon-air` and `book-trackon-sf` | nothing | `trackon-booking-failed` at once |

Each step also adds a line to `trackon.history`. Scans sent after
delivery or RHOD are stored but not polled.

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
POST /admin/attach-awb/:orderId
POST /admin/mock-scan/:orderId   (TRACKON_MOCK=true only)
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
