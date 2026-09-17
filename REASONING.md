# REASONING

## 1. Requirements interpreted

The product is a home-style tiffin subscription manager. The main business rule is that customers pay for the weekdays they were actually served. Customers may pause deliveries for travel or festivals, and paused weekdays must not be billed.

The assessment also requires a real database, REST APIs, authentication, search, a usable UI, a one-page product explanation, pagination, and sorting.

## 2. Architecture choice

I used a small monolithic Node.js + Express application with a static HTML/CSS/JavaScript frontend and SQLite.

The goal was to keep the architecture easy to explain and fast to implement inside a strict 2.5-hour assessment. A heavier frontend framework would add setup and build overhead without helping the core business logic.

## 3. Database design

The core entities are:

- `users` — application accounts and password hashes.
- `customers` — customer identity, phone, and address.
- `subscriptions` — plan, price, start date, and active state.
- `pause_periods` — pause start and resume dates.

Foreign keys connect subscriptions and pauses to customers. Indexes are added for phone and customer-based lookups.

The pause history is intentionally modeled as date ranges instead of a single boolean flag. This preserves the information needed to calculate exactly which weekdays were paused.

## 4. Authentication

Passwords are hashed with bcryptjs rather than stored as plain text. JWTs are used for stateless API authentication. Protected routes read the token from the `Authorization: Bearer ...` header.

## 5. Billing logic

Billing is implemented as a separate service so route handlers stay focused on HTTP concerns.

For a selected month:

```text
service_days = weekdays within the subscription's service period
paused_days  = paused weekdays overlapping that period
served_days  = service_days - paused_days
amount       = monthly_price * served_days / service_days
```

The subscription start date is included as the first service date. The resume date is treated as active again, so the pause interval is `[pauseStart, resumeDate)`.

The calculation also clips pauses to the billing month. This is important for pauses that cross month boundaries.

## 6. Customer state

The dashboard derives customer status from the current subscription and current open pause rather than introducing another duplicated status column. This reduces the chance of inconsistent state.

## 7. Search, pagination, and sorting

Customer APIs support search by name or phone. Lists expose page and limit values, and sorting fields are mapped through allowlists before being inserted into SQL. This avoids accepting arbitrary SQL identifiers from query parameters.

The billing list calculates bill details for the requested month and then applies the supported sort fields and pagination in application code. This keeps the business rule centralized in the billing service.

## 8. UI decision

The UI uses plain browser JavaScript and the REST APIs directly. It provides the required landing page, authentication forms, owner dashboard, search/filter controls, pagination, sorting, pause/resume actions, and billing tables.

## 9. Validation and error handling

The API validates required fields, duplicate customer phone numbers, duplicate active subscriptions, date formats, invalid pause ranges, overlapping pauses, missing subscriptions, invalid month values, and authentication failures.

Errors return JSON with a `success: false` flag and a user-readable `message`.

## 10. Testing performed

Manual API checks were used during implementation for:

1. Health and SQLite connection.
2. Registration.
3. Login.
4. Protected `/api/auth/me`.
5. Customer creation.
6. Subscription creation and retrieval.
7. Pause and resume.
8. September 2026 prorated billing.
9. Customer status filtering.
10. Customer search/pagination/sorting.
11. Owner billing list sorting and pagination.
12. UI login/register and dashboard flow.

The September billing example was verified with:

```text
Monthly price = ₹3000
Service weekdays = 22
Paused weekdays = 3
Served weekdays = 19
Bill = ₹3000 × 19 / 22 = ₹2590.91
```

A small automated Node test suite also covers the core weekday/proration calculations.

## 11. Assessment twists

The architecture deliberately keeps business concerns separated so a teacher-provided twist can be added without replacing the base system:

- T1 can add an outbox/clock service around the existing customer/subscription/pause state.
- T6 should add subscription ownership history rather than mutating historical ownership in place.
- T4 should add a normalization/import layer that reports imported, deduped, and rejected rows.

Only the assigned twist should be implemented during the timed assessment.
