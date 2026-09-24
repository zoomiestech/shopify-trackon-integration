# MongoDB Atlas setup

This version no longer stores AWBs/jobs in Render's filesystem. All persistent data lives in MongoDB Atlas.

## 1. Create a free Atlas deployment

1. Sign in to MongoDB Atlas.
2. Create a project, for example `Shopify Trackon`.
3. Create the free cluster/deployment.
4. Create a database user with a strong username/password.
5. In Network Access, allow the backend to connect.

For the quickest Render test you can temporarily allow:

```text
0.0.0.0/0
```

Use a strong database password. This permits network access from anywhere but still requires MongoDB authentication. Tighten network access later when your hosting setup has predictable outbound IPs.

## 2. Get the connection string

Atlas → Connect → Drivers → Node.js.

It will look similar to:

```text
mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

If the username/password contains reserved URL characters, use the URI Atlas generates or URL-encode the credentials.

## 3. Add to local `.env`

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB=shopify_trackon
```

Then run:

```bash
npm install
npm run test:mongodb
```

Expected:

```text
MongoDB connected...
MongoDB connection OK
```

## 4. Add to Render

Render → your service → Environment:

```env
MONGODB_URI=your Atlas URI
MONGODB_DB=shopify_trackon
```

Redeploy.

Open:

```text
https://YOUR-RENDER-URL/health
```

You should see:

```json
{
  "persistence": "mongodb",
  "mongodb": {
    "state": "connected"
  }
}
```

## 5. Persistence test

Keep:

```env
TRACKON_MOCK=true
BOOKING_TRIGGER=orders_create
SHOPIFY_NOTIFY_CUSTOMER=false
```

Create a fresh Shopify order.

Check:

```http
GET /admin/shipments
x-admin-key: YOUR_ADMIN_API_KEY
```

You should get `count: 1` (or higher).

Now manually redeploy/restart Render.

Call `/admin/shipments` again.

The same shipment must still be present. That proves persistence is working.

## Collections created automatically

Mongoose creates these collections as needed:

```text
jobs
shipments
oauthstates
oauthtokens
```

The important production safety property is:

```text
Shopify order ID → unique Shipment document → persisted AWB
```

If Trackon booking succeeds and Shopify fulfillment fails later, a retry reads the existing AWB from MongoDB instead of generating another Trackon booking.
