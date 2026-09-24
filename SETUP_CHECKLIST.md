# Shopify ↔ Trackon MongoDB go-live checklist

## MongoDB
- [ ] Atlas cluster created
- [ ] Database user created
- [ ] Network access configured
- [ ] `MONGODB_URI` added locally
- [ ] `npm run test:mongodb` succeeds
- [ ] `MONGODB_URI` added to Render
- [ ] `/health` says MongoDB connected

## Shopify
- [ ] Shopify app installed
- [ ] Shopify scopes configured
- [ ] `npm run test:shopify` succeeds
- [ ] `PUBLIC_BASE_URL` is the live Render URL
- [ ] `npm run register-webhooks` succeeds
- [ ] `TRACKON_MOCK=true`
- [ ] new Shopify test order created
- [ ] `/admin/jobs` shows `orders/create` done
- [ ] `/admin/shipments` contains mock AWB
- [ ] Shopify order is fulfilled with Trackon mock AWB

## Persistence
- [ ] Restart/redeploy Render
- [ ] `/admin/shipments` still contains the same order/AWB

## Trackon
- [ ] Trackon test credentials obtained
- [ ] CustomerCode confirmed
- [ ] PickupCustCode or pickup address confirmed
- [ ] TypeOfService confirmed
- [ ] ServiceType confirmed
- [ ] Trackon known AWB tracking test succeeds
- [ ] One controlled real booking verified
- [ ] Only then set `TRACKON_MOCK=false` for production
