# Assessment Twist Implementation

TiffinTrack implements all three supplied assessment twists.

## T1 — Morning delivery notification

### Endpoints

```http
POST /clock
Content-Type: application/json

{"date":"2026-09-17"}
```

The date is optional; supplying it makes grading deterministic.

The clock checks:
- active subscription
- Monday through Friday
- customer is not inside an open/active pause interval

The notification is written to the SQLite `notification_outbox` table through `src/services/notificationService.js`.

Inspect the outbox:

```http
GET /outbox?date=2026-09-17
```

The same endpoints are also available under `/api/clock` and `/api/outbox`.

The outbox has a unique `(customer_id, delivery_date)` rule so running the same clock twice does not duplicate the notification.

## T6 — Subscription transfer

### Endpoint

```http
POST /api/subscriptions/:subscriptionId/transfer
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "toCustomerId": 2,
  "effectiveDate": "2026-09-15"
}
```

The same transfer route is also available at `/subscriptions/:subscriptionId/transfer`.

The implementation keeps the original subscription ID, plan, monthly price and start date. Ownership changes are recorded in `subscription_transfers`, allowing historical ownership to be reconstructed.

Billing uses the customer's served weekdays only and allocates the monthly price across ownership segments. For example, a ₹3000 September plan with 22 service weekdays and a transfer on September 15 splits 10 weekdays to the original customer and 12 weekdays to the new customer:

```text
Original owner = 3000 * 10 / 22 = ₹1363.64
New owner      = 3000 * 12 / 22 = ₹1636.36
Total          = ₹3000.00
```

Pause periods are evaluated against the customer who owned the subscription during that segment.

## T4 — Messy customer import

### Endpoint

```http
POST /api/import/customers
Authorization: Bearer <JWT>
Content-Type: application/json
```

JSON array example:

```json
{
  "customers": [
    {
      "name": "Asha",
      "phone": "98765 43210",
      "address": "Jaipur",
      "plan": "Monthly Lunch",
      "monthly_price": "3,000",
      "start_date": "01/09/2026"
    },
    {
      "name": "Asha Duplicate",
      "phone": "9876543210",
      "monthly_price": "3000",
      "start_date": "2026-09-01"
    }
  ]
}
```

CSV text is also accepted with a `csv` field. The importer normalizes phone values, supports `YYYY-MM-DD`, `YYYY/MM/DD`, `DD/MM/YYYY`, and `DD-MM-YYYY`. When a numeric slash/dash date is ambiguous (for example `01/09/2026`), the importer uses DD/MM/YYYY as the assessment locale convention.

Rows with missing/invalid required fields are rejected. Duplicate phones inside the import or already present in the database are counted as deduped.

The response contains the required counters:

```json
{
  "imported": 1,
  "deduped": 1,
  "rejected": 0
}
```

Additional `errors` and `deduped_rows` arrays explain rejected and duplicate rows.
