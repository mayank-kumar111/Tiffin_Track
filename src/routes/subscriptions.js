const express = require("express");
const db = require("../db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

router.post("/", authenticateToken, (req, res) => {
  try {
    const { customerId, planName, monthlyPrice, startDate } = req.body;

    if (!customerId || !planName || monthlyPrice === undefined) {
      return res.status(400).json({
        success: false,
        message: "customerId, planName, and monthlyPrice are required"
      });
    }

    const price = Number(monthlyPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({
        success: false,
        message: "monthlyPrice must be a positive number"
      });
    }

    const effectiveStartDate = startDate || new Date().toISOString().slice(0, 10);
    if (!isValidDate(effectiveStartDate)) {
      return res.status(400).json({
        success: false,
        message: "startDate must use YYYY-MM-DD format"
      });
    }

    const customer = db
      .prepare("SELECT id, name, phone FROM customers WHERE id = ?")
      .get(customerId);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    const activeSubscription = db
      .prepare("SELECT id FROM subscriptions WHERE customer_id = ? AND active = 1")
      .get(customerId);

    if (activeSubscription) {
      return res.status(409).json({
        success: false,
        message: "Customer already has an active subscription"
      });
    }

    const result = db
      .prepare(
        `INSERT INTO subscriptions
         (customer_id, plan_name, monthly_price, start_date, active)
         VALUES (?, ?, ?, ?, 1)`
      )
      .run(customerId, planName.trim(), price, effectiveStartDate);

    const subscription = db
      .prepare("SELECT * FROM subscriptions WHERE id = ?")
      .get(result.lastInsertRowid);

    return res.status(201).json({
      success: true,
      message: "Subscription created successfully",
      subscription
    });
  } catch (error) {
    console.error("Subscription creation error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create subscription"
    });
  }
});

router.get("/customer/:customerId", authenticateToken, (req, res) => {
  const customerId = Number(req.params.customerId);

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid customerId"
    });
  }

  const subscription = db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE customer_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(customerId);

  if (!subscription) {
    return res.status(404).json({
      success: false,
      message: "Subscription not found"
    });
  }

  return res.json({
    success: true,
    subscription
  });
});

router.patch("/:id/deactivate", authenticateToken, (req, res) => {
  const subscriptionId = Number(req.params.id);

  if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid subscription id"
    });
  }

  const result = db
    .prepare("UPDATE subscriptions SET active = 0 WHERE id = ? AND active = 1")
    .run(subscriptionId);

  if (!result.changes) {
    return res.status(404).json({
      success: false,
      message: "Active subscription not found"
    });
  }

  const subscription = db
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(subscriptionId);

  return res.json({
    success: true,
    message: "Subscription deactivated",
    subscription
  });
});

module.exports = router;
