const express = require("express");
const db = require("../db");
const { authenticateToken } = require("../middleware/auth");
const { notifyDueCustomers, validateDate } = require("../services/notificationService");

const router = express.Router();

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/[\s()-]/g, "");
}

function normalizeDate(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(`${raw}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
  }

  const slashOrDash = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (slashOrDash) {
    let [, first, second, year] = slashOrDash;
    let month;
    let day;
    const a = Number(first);
    const b = Number(second);

    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else {
      month = a;
      day = b;
    }

    const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(`${normalized}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized
      ? normalized
      : null;
  }

  return null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((header) =>
    header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
  );

  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || "";
    });
    return record;
  });
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function rowsFromRequest(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.customers)) return body.customers;
  if (Array.isArray(body.rows)) return body.rows;
  if (Array.isArray(body.data)) return body.data;
  if (typeof body.csv === "string") return parseCsv(body.csv);
  return [];
}

// T1: deterministic clock used by the evaluator. Both /clock and /api/clock work.
router.post("/clock", (req, res) => {
  const deliveryDate = req.body?.date || req.body?.deliveryDate || new Date().toISOString().slice(0, 10);
  if (!validateDate(deliveryDate)) {
    return res.status(400).json({ success: false, message: "date must use YYYY-MM-DD format" });
  }

  try {
    const result = notifyDueCustomers(deliveryDate);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Clock error:", error);
    return res.status(500).json({ success: false, message: "Unable to process delivery clock" });
  }
});

router.get("/outbox", (req, res) => {
  const date = req.query.date ? String(req.query.date) : null;
  if (date && !validateDate(date)) {
    return res.status(400).json({ success: false, message: "date must use YYYY-MM-DD format" });
  }

  const rows = db.prepare(
    `SELECT id, customer_id, subscription_id, delivery_date, channel, message, created_at
     FROM notification_outbox
     ${date ? "WHERE delivery_date = ?" : ""}
     ORDER BY id DESC`
  ).all(...(date ? [date] : []));

  return res.json({ success: true, count: rows.length, outbox: rows });
});

// T6: transfer an existing subscription without creating a new plan/cycle.
router.post("/subscriptions/:id/transfer", authenticateToken, (req, res) => {
  const subscriptionId = Number(req.params.id);
  const toCustomerId = Number(req.body?.toCustomerId);
  const effectiveDate = req.body?.effectiveDate;

  if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid subscription id" });
  }
  if (!Number.isInteger(toCustomerId) || toCustomerId <= 0) {
    return res.status(400).json({ success: false, message: "toCustomerId must be a positive integer" });
  }
  if (!validateDate(effectiveDate)) {
    return res.status(400).json({ success: false, message: "effectiveDate must use YYYY-MM-DD format" });
  }

  const subscription = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subscriptionId);
  if (!subscription) return res.status(404).json({ success: false, message: "Subscription not found" });
  if (!subscription.active) return res.status(409).json({ success: false, message: "Only an active subscription can be transferred" });
  if (subscription.customer_id === toCustomerId) {
    return res.status(400).json({ success: false, message: "Subscription already belongs to this customer" });
  }
  if (effectiveDate < subscription.start_date) {
    return res.status(400).json({ success: false, message: "effectiveDate cannot be before the subscription start date" });
  }

  const targetCustomer = db.prepare("SELECT id, name, phone FROM customers WHERE id = ?").get(toCustomerId);
  if (!targetCustomer) return res.status(404).json({ success: false, message: "Target customer not found" });

  const targetActive = db.prepare(
    "SELECT id FROM subscriptions WHERE customer_id = ? AND active = 1"
  ).get(toCustomerId);
  if (targetActive) {
    return res.status(409).json({
      success: false,
      message: "Target customer already has an active subscription"
    });
  }

  const conflictingTransfer = db.prepare(
    "SELECT id FROM subscription_transfers WHERE subscription_id = ? AND effective_date = ?"
  ).get(subscriptionId, effectiveDate);
  if (conflictingTransfer) {
    return res.status(409).json({ success: false, message: "A transfer already exists for this effective date" });
  }

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO subscription_transfers
       (subscription_id, from_customer_id, to_customer_id, effective_date)
       VALUES (?, ?, ?, ?)`
    ).run(subscriptionId, subscription.customer_id, toCustomerId, effectiveDate);

    db.prepare("UPDATE subscriptions SET customer_id = ? WHERE id = ?").run(toCustomerId, subscriptionId);
  });

  try {
    transaction();
  } catch (error) {
    console.error("Subscription transfer error:", error);
    return res.status(500).json({ success: false, message: "Unable to transfer subscription" });
  }

  const updated = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subscriptionId);
  return res.json({
    success: true,
    message: "Subscription transferred successfully",
    subscription: updated,
    transfer: db.prepare(
      "SELECT * FROM subscription_transfers WHERE subscription_id = ? ORDER BY effective_date DESC, id DESC LIMIT 1"
    ).get(subscriptionId)
  });
});

// T4: import JSON rows or CSV text and report imported/deduped/rejected rows.
router.post("/import/customers", authenticateToken, (req, res) => {
  const rows = rowsFromRequest(req.body || {});
  if (!rows.length) {
    return res.status(400).json({
      success: false,
      message: "Provide customers/rows/data array or a csv string"
    });
  }

  const report = {
    imported: 0,
    deduped: 0,
    rejected: 0,
    errors: [],
    deduped_rows: []
  };

  const seenPhones = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const name = String(firstValue(row, ["name", "customer_name"]).trim());
    const phone = normalizePhone(firstValue(row, ["phone", "mobile", "mobile_number", "phone_number"]));
    const addressValue = firstValue(row, ["address", "location"]);
    const planName = String(firstValue(row, ["plan_name", "plan", "subscription", "package"]) || "Monthly Lunch").trim();
    const priceRaw = firstValue(row, ["monthly_price", "price", "amount", "monthly_amount"]);
    const startRaw = firstValue(row, ["start_date", "start", "subscription_start", "date"]);
    const startDate = normalizeDate(startRaw);
    const price = Number(String(priceRaw).replace(/[,₹$]/g, "").trim());
    const rowNumber = index + 2;

    const errors = [];
    if (!name) errors.push("missing name");
    if (!phone) errors.push("missing phone");
    if (phone && (phone.length < 7 || phone.length > 15)) errors.push("invalid phone");
    if (!Number.isFinite(price) || price <= 0) errors.push("invalid monthly price");
    if (!startDate) errors.push("invalid or missing start date");

    if (errors.length) {
      report.rejected += 1;
      report.errors.push({ row: rowNumber, reason: errors.join(", ") });
      continue;
    }

    if (seenPhones.has(phone)) {
      report.deduped += 1;
      report.deduped_rows.push({ row: rowNumber, phone, reason: "duplicate phone in import" });
      continue;
    }
    seenPhones.add(phone);

    const existingCustomer = db.prepare("SELECT id FROM customers WHERE phone = ?").get(phone);
    if (existingCustomer) {
      report.deduped += 1;
      report.deduped_rows.push({ row: rowNumber, phone, reason: "phone already exists" });
      continue;
    }

    try {
      const transaction = db.transaction(() => {
        const customerResult = db.prepare(
          "INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)"
        ).run(name, phone, addressValue ? String(addressValue).trim() : null);

        db.prepare(
          `INSERT INTO subscriptions
           (customer_id, plan_name, monthly_price, start_date, active)
           VALUES (?, ?, ?, ?, 1)`
        ).run(customerResult.lastInsertRowid, planName, price, startDate);
      });

      transaction();
      report.imported += 1;
    } catch (error) {
      report.rejected += 1;
      report.errors.push({ row: rowNumber, reason: "database insert failed" });
    }
  }

  return res.status(200).json({ success: true, ...report });
});

module.exports = router;
