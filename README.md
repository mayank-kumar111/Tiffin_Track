# TiffinTrack

TiffinTrack is a lightweight subscription and billing system for home-style tiffin/lunch businesses. It manages customers, monthly subscriptions, pause/resume periods, customer status, and prorated monthly bills based on weekdays actually served.

## Problem solved

A tiffin owner needs to:

- register and search customers by phone or name;
- manage monthly subscriptions;
- pause deliveries for travel/festivals;
- resume deliveries without charging for paused weekdays;
- see active vs paused customers;
- calculate month-end bills from actual weekdays served;
- search, sort, and paginate customer/billing data.

## Stack

- Node.js + Express
- SQLite + better-sqlite3
- HTML/CSS/JavaScript frontend
- bcryptjs for password hashing
- JSON Web Tokens (JWT) for authentication

## Project structure

```text
Tiffin_Track/
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── src/
│   ├── db.js
│   ├── server.js
│   ├── middleware/
│   │   └── auth.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── customers.js
│   │   ├── subscriptions.js
│   │   ├── pauses.js
│   │   └── bills.js
│   └── services/
│       └── billing.js
├── tests/
│   └── billing.test.js
├── data/
│   └── tiffin_track.db
├── README.md
├── REASONING.md
└── package.json
```

## Setup

Requirements: Node.js 18+.

```bash
git clone https://github.com/mayank-kumar111/Tiffin_Track.git
cd Tiffin_Track
npm install
```

Optional environment variable:

```bash
JWT_SECRET=replace-with-a-long-random-secret
```

For the assessment, the app also has a development fallback secret when `JWT_SECRET` is not provided. Set a real secret for any non-demo deployment.

## Run

```bash
npm start
```

The server starts on port 3000 by default. Open the forwarded Codespaces port in a browser.

Health check:

```bash
curl http://localhost:3000/api/health
```

Expected response includes `"database":"connected"`.

## Test

```bash
npm test
```

The current automated tests cover core weekday/prorated billing calculations. Manual API and UI checks were also used during development.

## Billing rule

For a billing month:

```text
service_days = weekdays covered by the subscription in that month
paused_days  = paused weekdays inside that service period
served_days  = service_days - paused_days
amount       = monthly_price * served_days / service_days
```

The `resumeDate` is active again, so a pause interval behaves like `[pauseStart, resumeDate)`.

Example: for a ₹3000 plan with 22 service weekdays and 3 paused weekdays:

```text
served_days = 22 - 3 = 19
amount = 3000 * 19 / 22 = ₹2590.91
```

## Authentication API

All protected endpoints require:

```http
Authorization: Bearer <JWT>
```

### Register

```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "Test User",
  "email": "test@tiffintrack.com",
  "password": "Test@123"
}
```

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "test@tiffintrack.com",
  "password": "Test@123"
}
```

### Current user

```http
GET /api/auth/me
```

## Customer API

### Create customer

```http
POST /api/customers
```

Body:

```json
{
  "name": "Rahul Sharma",
  "phone": "9876543210",
  "address": "Jaipur, Rajasthan"
}
```

### List/search customers

```http
GET /api/customers?page=1&limit=10&search=Rahul&sort=name&order=asc
```

Supported customer sorting fields include `name`, `phone`, and `created_at`.

Status filtering:

```http
GET /api/customers?status=active
GET /api/customers?status=paused
GET /api/customers?status=inactive
```

### Get one customer

```http
GET /api/customers/:id
```

### Update customer

```http
PUT /api/customers/:id
```

## Subscription API

### Create subscription

```http
POST /api/subscriptions
```

Body:

```json
{
  "customerId": 1,
  "planName": "Monthly Lunch",
  "monthlyPrice": 3000,
  "startDate": "2026-09-01"
}
```

### Get customer's latest subscription

```http
GET /api/subscriptions/customer/:customerId
```

### Deactivate subscription

```http
PATCH /api/subscriptions/:id/deactivate
```

## Pause / resume API

### Pause customer

```http
POST /api/customers/:customerId/pause
```

```json
{
  "pauseStart": "2026-09-14"
}
```

### Resume customer

```http
POST /api/customers/:customerId/resume
```

```json
{
  "resumeDate": "2026-09-17"
}
```

### View pause history

```http
GET /api/customers/:customerId/pauses
```

## Billing API

### Customer bill

```http
GET /api/customers/:customerId/bill?month=2026-09
```

### Owner billing list

```http
GET /api/bills?month=2026-09&page=1&limit=10&sort=amount&order=desc
```

Supported billing sort fields include `amount`, `served_days`, `paused_days`, `name`, and `phone`.

## UI

The browser UI provides:

- landing page with product overview;
- login/register;
- customer creation;
- customer search and status filtering;
- pagination and sorting;
- pause/resume controls;
- monthly billing table;
- individual bill lookup;
- logout.

## Assessment twists

The base architecture is prepared for the possible teacher-provided twists:

- **T1 — Notifications:** daily delivery notifications via `/clock` and `/outbox`.
- **T6 — Subscription transfer:** preserve ownership/service history so billing can split a cycle between customers.
- **T4 — Messy import:** normalize and deduplicate imported customer data and return `{ imported, deduped, rejected }`.

Only the twist actually assigned during the assessment should be implemented to protect the time budget.

## Notes

The SQLite file is created automatically under `data/` when the server starts. Do not commit production secrets or real customer data.
