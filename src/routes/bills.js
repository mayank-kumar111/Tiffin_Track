const express = require("express");
const db = require("../db");
const { authenticateToken } = require("../middleware/auth");
const { getCustomerBill, getMonthBounds } = require("../services/billing");

const router = express.Router();

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const SORT_COLUMNS = {
  name: "c.name",
  phone: "c.phone",
  amount: "billing_amount",
  served_days: "served_days",
  paused_days: "paused_days"
};

router.get("/", authenticateToken, (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    if (!getMonthBounds(month)) {
      return res.status(400).json({
        success: false,
        message: "month must use YYYY-MM format"
      });
    }

    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 10), 50);
    const sort = SORT_COLUMNS[req.query.sort] ? req.query.sort : "name";
    const order = String(req.query.order).toLowerCase() === "desc" ? "DESC" : "ASC";

    const customers = db
      .prepare(
        `SELECT c.id, c.name, c.phone
         FROM customers c
         INNER JOIN subscriptions s ON s.customer_id = c.id
         WHERE s.id = (
           SELECT s2.id
           FROM subscriptions s2
           WHERE s2.customer_id = c.id
           ORDER BY s2.active DESC, s2.id DESC
           LIMIT 1
         )
         ORDER BY c.name ASC`
      )
      .all();

    const bills = customers.map((customer) => {
      const result = getCustomerBill(customer.id, month);
      return {
        customer_id: customer.id,
        name: customer.name,
        phone: customer.phone,
        plan_name: result.subscription.plan_name,
        monthly_price: result.subscription.monthly_price,
        service_days: result.billing.service_days,
        paused_days: result.billing.paused_days,
        served_days: result.billing.served_days,
        amount: result.billing.amount
      };
    });

    bills.sort((a, b) => {
      const aValue = sort === "amount" ? a.amount : sort === "served_days" ? a.served_days : sort === "paused_days" ? a.paused_days : a[sort];
      const bValue = sort === "amount" ? b.amount : sort === "served_days" ? b.served_days : sort === "paused_days" ? b.paused_days : b[sort];
      return order === "ASC"
        ? String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" })
        : String(bValue).localeCompare(String(aValue), undefined, { numeric: true, sensitivity: "base" });
    });

    const total = bills.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    return res.json({
      success: true,
      month,
      pagination: {
        page,
        limit,
        total,
        totalPages
      },
      sort: {
        field: sort,
        order: order.toLowerCase()
      },
      bills: bills.slice(offset, offset + limit)
    });
  } catch (error) {
    console.error("Billing list error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to calculate bills"
    });
  }
});

router.get("/:customerId", authenticateToken, (req, res) => {
  const customerId = Number(req.params.customerId);
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid customerId"
    });
  }

  if (!getMonthBounds(month)) {
    return res.status(400).json({
      success: false,
      message: "month must use YYYY-MM format"
    });
  }

  const customerExists = db
    .prepare("SELECT id FROM customers WHERE id = ?")
    .get(customerId);

  if (!customerExists) {
    return res.status(404).json({
      success: false,
      message: "Customer not found"
    });
  }

  const bill = getCustomerBill(customerId, month);

  if (!bill) {
    return res.status(404).json({
      success: false,
      message: "Subscription not found"
    });
  }

  return res.json({
    success: true,
    ...bill
  });
});

module.exports = router;
