# Go-live setup checklist

## Phase A — Shopify-only test
1. Create Shopify Dev Dashboard app.
2. Add the required scopes.
3. Configure protected customer data.
4. Install/authorize the app.
5. Set `TRACKON_MOCK=true`.
6. Deploy the bridge to HTTPS.
7. Set `PUBLIC_BASE_URL`.
8. Run `npm run test:shopify`.
9. Run `npm run register-webhooks`.
10. Create one Shopify test order.
11. Confirm `/admin/shipments` shows a mock AWB.
12. Confirm Shopify fulfillment contains `Trackon` + mock tracking number.

## Phase B — Trackon connectivity
1. Get Trackon test credentials.
2. Confirm CustomerCode.
3. Confirm PickupCustCode or pickup address.
4. Confirm TypeOfService.
5. Confirm ServiceType/AWB series.
6. Confirm weight unit.
7. Run `npm run test:tracking -- <known-AWB>` on a real known AWB.
8. Ask Trackon for one exact sample booking request + response.

## Phase C — One controlled real booking
1. Set `TRACKON_MOCK=false`.
2. Keep `SHOPIFY_NOTIFY_CUSTOMER=false`.
3. Create one controlled Shopify order.
4. Confirm one and only one AWB is generated.
5. Confirm Trackon booking response in `data/store.json`.
6. Confirm Shopify fulfillment.
7. Confirm tracking API can read the new AWB.
8. Trigger `/admin/run-tracking`.
9. Confirm metafields update if enabled.

## Phase D — Production
1. Configure persistent storage.
2. Set customer notification choice.
3. Confirm `BOOKING_TRIGGER`.
4. Rotate `ADMIN_API_KEY`.
5. Confirm cancellation SOP.
6. Confirm polling/rate limit with Trackon.
7. Monitor first 10–20 production orders closely.
