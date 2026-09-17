# AI_LOGS.md

> Reconstructed user-visible transcript of the AI-assisted development session for TiffinTrack.
> This file is provided as a reconstruction and is not an exact platform transcript export.

---

## Project: TiffinTrack

### User
I have a timed full-stack project for a Round 2 Builder hiring assessment.

The assignment is a 2.5 hour strict assessment for a home-style tiffin/lunch delivery system.

Customers subscribe monthly, receive lunch on weekdays, can pause/resume for travel/festivals, and paused days should not be charged.

At month end, the owner needs prorated billing based on actual weekdays served.

Customer lookup should work by phone and the owner should see active versus paused customers.

Mandatory:
1. Real database with sensible schema.
2. REST APIs for core operations.
3. Usable UI.
4. User registration and login.
5. Search.
6. One-page landing page describing the product, features, target audience, benefits, and 3 next features.
7. Pagination and sorting.

The teacher may later provide one twist.

### AI
Recommended product: TiffinTrack.

Recommended stack:
- Node.js
- Express
- HTML/CSS/JavaScript
- SQLite with better-sqlite3
- bcryptjs
- JWT

Core billing rule:

service_days = weekdays in the billing period

paused_days = paused weekdays within that period

served_days = service_days - paused_days

bill = monthly price × served_days / service_days

Example:
₹3000 monthly price
22 service weekdays
3 paused weekdays
19 served weekdays

Bill = ₹3000 × 19 / 22 = ₹2590.91

Suggested schema:

users:
id, name, email, password_hash, created_at

customers:
id, name, phone, address, created_at

subscriptions:
id, customer_id, plan_name, monthly_price, start_date, active, created_at

pause_periods:
id, customer_id, pause_start, resume_date, created_at

The system should include authentication, customer management, subscription management, pause/resume, billing, search, pagination, sorting, and a simple dashboard.

---

## Repository setup

### User
Repository:
mayank-kumar111/Tiffin_Track

Codespace:
animated adventure

### AI
Start with npm and Express.

### User
Ran:

npm init -y

Then:

npm install express cors dotenv

### AI
Created the initial Express server with:
- CORS
- JSON parsing
- static frontend support
- `/api/health`
- port 3000

### User
Committed the dependency lockfile:

git add package-lock.json
git commit -m "Add dependency lockfile"
git push origin main

Result:
commit 2f61a5e

---

## Database

### AI
Added SQLite database setup in:

src/db.js

Tables:
- users
- customers
- subscriptions
- pause_periods

Added foreign keys and indexes.

Updated server health endpoint to show database connection status.

### User
Ran:

npm install better-sqlite3

Result:
2 packages added.
0 vulnerabilities.

Then:

git status

The changed files were:
package.json
package-lock.json

### AI
Asked the user to commit the dependency changes.

### User
Ran:

git add package.json package-lock.json
git commit -m "Add SQLite database dependency"
git push origin main
git status

Result:
commit 25754d5

Working tree clean.

---

## Authentication

### AI
Added:
src/middleware/auth.js
src/routes/auth.js

Features:
- registration
- password hashing with bcryptjs
- login
- JWT generation
- protected `/api/auth/me`

### User
Installed:

npm install bcryptjs jsonwebtoken

Then synchronized GitHub changes.

Commit:
9e1ac82

### User
Started server:

node src/server.js

Output:

TiffinTrack server running on port 3000

### User
Health check:

curl http://localhost:3000/api/health

Response:

{
  "success": true,
  "message": "TiffinTrack API is running",
  "database": "connected"
}

### AI
Test registration.

### User
Ran:

curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@tiffintrack.com","password":"Test@123"}'

Registration succeeded and returned:
id = 1
name = Test User
email = test@tiffintrack.com

### AI
Test login.

### User
Login succeeded using:

email:
test@tiffintrack.com

password:
Test@123

### User
Initially tested `/api/auth/me` with an incomplete token and received:

{
  "success": false,
  "message": "Invalid or expired authentication token"
}

### AI
Explained that the JWT had been truncated and suggested storing it in a shell variable.

### User
Ran login and stored the token in:

TOKEN

Then:

curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

Response:

{
  "success": true,
  "user": {
    "id": 1,
    "name": "Test User",
    "email": "test@tiffintrack.com",
    "created_at": "2026-09-17 10:13:20"
  }
}

Authentication was verified.

---

## Customer management

### AI
Added customer routes:
- POST /api/customers
- GET /api/customers
- GET /api/customers/:id
- PUT /api/customers/:id

Features:
- search by name and phone
- pagination
- sorting
- duplicate phone validation
- JWT protection

### User
Pulled changes and started the server successfully.

### User
Created customer:

curl -X POST http://localhost:3000/api/customers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Rahul Sharma","phone":"9876543210","address":"Jaipur, Rajasthan"}'

Response:

{
  "success": true,
  "message": "Customer created successfully",
  "customer": {
    "id": 1,
    "name": "Rahul Sharma",
    "phone": "9876543210",
    "address": "Jaipur, Rajasthan"
  }
}

---

## Possible teacher twists

### User
The teacher may give one of these twists:

T1:
Each morning notify customers due for delivery today through Notification Service.
Graded via `/outbox` after `POST /clock`.

T6:
Transfer a subscription to a new customer mid-cycle.
The plan and cycle carry over and billing splits according to who was served.

T4:
Import messy customer data with duplicate phones, mixed date formats, blanks, and produce:

{
  imported,
  deduped,
  rejected
}

### AI
Recommended implementing only the twist actually assigned by the teacher to protect the assessment time.

For T1:
introduce clock/outbox processing.

For T6:
preserve subscription ownership history.

For T4:
normalize, validate, deduplicate, and report rejected rows.

---

## Subscriptions

### AI
Added subscription management.

Endpoints:
POST /api/subscriptions
GET /api/subscriptions/customer/:customerId
PATCH /api/subscriptions/:id/deactivate

### User
Checked subscription:

curl http://localhost:3000/api/subscriptions/customer/1 \
  -H "Authorization: Bearer $TOKEN"

Response confirmed:

id = 1
customer_id = 1
plan_name = Monthly Lunch
monthly_price = 3000
start_date = 2026-09-01
active = 1

---

## Pause and resume

### AI
Added:
POST /api/customers/:customerId/pause
POST /api/customers/:customerId/resume
GET /api/customers/:customerId/pauses

Business rule:
pauseStart is inclusive
resumeDate is active again

Therefore the pause interval behaves like:

[pauseStart, resumeDate)

### User
Paused Rahul:

curl -X POST http://localhost:3000/api/customers/1/pause \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"pauseStart":"2026-09-14"}'

Response confirmed a pause period.

### User
Resumed Rahul:

curl -X POST http://localhost:3000/api/customers/1/resume \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"resumeDate":"2026-09-17"}'

Result:
pause_start = 2026-09-14
resume_date = 2026-09-17

Therefore:
September 14, 15, 16 were paused weekdays.
September 17 was active again.

---

## Billing engine

### AI
Implemented billing service in:

src/services/billing.js

Billing rule:

service_days = weekdays covered by the subscription in the month
paused_days = paused weekdays in that service period
served_days = service_days - paused_days
amount = monthly_price * served_days / service_days

Also handles:
- month boundaries
- subscriptions starting mid-month
- pause periods crossing month boundaries
- weekday-only calculations

### User
First billing request failed because the shell token variable was empty.

### AI
Explained and regenerated TOKEN.

### User
Ran:

curl "http://localhost:3000/api/customers/1/bill?month=2026-09" \
  -H "Authorization: Bearer $TOKEN"

Response:

{
  "success": true,
  "customer": {
    "id": 1,
    "name": "Rahul Sharma",
    "phone": "9876543210"
  },
  "subscription": {
    "id": 1,
    "plan_name": "Monthly Lunch",
    "monthly_price": 3000,
    "start_date": "2026-09-01",
    "active": true
  },
  "billing": {
    "month": "2026-09",
    "monthly_price": 3000,
    "service_days": 22,
    "paused_days": 3,
    "served_days": 19,
    "amount": 2590.91
  }
}

Billing was verified.

---

## Search, status, pagination, sorting

### AI
Added owner-facing customer status functionality.

Examples:

GET /api/customers?status=active
GET /api/customers?status=paused
GET /api/customers?search=Rahul
GET /api/customers?page=1&limit=10&sort=name&order=asc

### User
Tested:

curl "http://localhost:3000/api/customers?status=active&page=1&limit=10&sort=name&order=asc" \
  -H "Authorization: Bearer $TOKEN"

Response showed Rahul as active.

### User
Tested:

curl "http://localhost:3000/api/bills?month=2026-09&page=1&limit=10&sort=amount&order=desc" \
  -H "Authorization: Bearer $TOKEN"

Response:

{
  "success": true,
  "month": "2026-09",
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  },
  "sort": {
    "field": "amount",
    "order": "desc"
  },
  "bills": [
    {
      "customer_id": 1,
      "name": "Rahul Sharma",
      "phone": "9876543210",
      "plan_name": "Monthly Lunch",
      "monthly_price": 3000,
      "service_days": 22,
      "paused_days": 3,
      "served_days": 19,
      "amount": 2590.91
    }
  ]
}

---

## UI

### AI
Built a responsive HTML/CSS/JavaScript UI.

Landing page includes:
- product explanation
- key features
- target audience
- how the product helps
- 3 next features

Dashboard includes:
- login/register
- customer search
- status filters
- pagination
- sorting
- customer creation
- subscription management
- pause/resume
- monthly bills
- individual bill lookup
- logout

### User
Initially reported that Login/Register buttons were not showing the form.

### AI
Inspected frontend wiring and fixed the JavaScript/auth flow.

### User
Later confirmed the UI was working and showed the dashboard with:

Test User
Total customers: 1
Active: 1
Paused: 0
September bill: ₹2590.91

Rahul Sharma was visible in the customer table.

---

## Documentation and tests

### AI
Added:
README.md
REASONING.md
tests/billing.test.js

Added npm scripts:
npm start
npm test

### User
Ran:

git pull origin main
git status
npm test

Result:

✔ calculates September 2026 bill with three paused weekdays
✔ counts only weekdays after a mid-month subscription starts

tests 2
pass 2
fail 0

Working tree was clean.

---

## Final validation

The following major functionality was verified:

- Express server starts successfully.
- SQLite database connects successfully.
- User registration works.
- User login works.
- JWT authentication works.
- Protected `/api/auth/me` works.
- Customer creation works.
- Customer search works.
- Customer pagination works.
- Customer sorting works.
- Customer status filtering works.
- Subscription creation works.
- Pause works.
- Resume works.
- Prorated weekday billing works.
- Billing list works.
- UI login/register works.
- UI dashboard works.
- Automated billing tests pass.

Verified billing example:

₹3000 monthly subscription
22 September weekdays
3 paused weekdays
19 served weekdays
Final amount = ₹2590.91

---

## Final assessment plan

The teacher may provide one twist.

Possible twists:

### T1
Daily delivery notifications:
POST /clock
GET /outbox

### T6
Subscription transfer:
Preserve service ownership history and split billing by customer.

### T4
Messy-data import:
Normalize records, deduplicate phones, reject invalid rows, and report:

{
  imported,
  deduped,
  rejected
}

Only the assigned twist should be implemented during the assessment to protect the time budget.

---

## Current repository

Repository:
https://github.com/mayank-kumar111/Tiffin_Track

Main stack:
Node.js
Express
SQLite
better-sqlite3
HTML/CSS/JavaScript
bcryptjs
JWT

End of reconstructed transcript.
