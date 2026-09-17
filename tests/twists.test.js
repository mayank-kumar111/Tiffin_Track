const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const { notifyDueCustomers } = require("../src/services/notificationService");
const { getCustomerBill } = require("../src/services/billing");

function uniquePhone(prefix) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  return `${prefix}${suffix}`.slice(0, 15);
}

test("T1 sends weekday delivery notifications once and skips paused customers", () => {
  const phone = uniquePhone("7");
  const customer = db.prepare(
    "INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)"
  ).run(`Twist Notify ${phone}`, phone, "Jaipur");
  const customerId = Number(customer.lastInsertRowid);
  const subscription = db.prepare(
    `INSERT INTO subscriptions (customer_id, plan_name, monthly_price, start_date, active)
     VALUES (?, ?, ?, ?, 1)`
  ).run(customerId, "Monthly Lunch", 3000, "2026-09-01");
  const subscriptionId = Number(subscription.lastInsertRowid);

  try {
    const first = notifyDueCustomers("2026-09-17");
    assert.equal(first.sent, 1);

    const second = notifyDueCustomers("2026-09-17");
    assert.equal(second.sent, 0);
    assert.equal(second.deduped, 1);

    db.prepare(
      "INSERT INTO pause_periods (customer_id, pause_start, resume_date) VALUES (?, ?, ?)"
    ).run(customerId, "2026-09-18", null);

    const paused = notifyDueCustomers("2026-09-18");
    assert.equal(paused.sent, 0);
  } finally {
    db.prepare("DELETE FROM notification_outbox WHERE customer_id = ?").run(customerId);
    db.prepare("DELETE FROM pause_periods WHERE customer_id = ?").run(customerId);
    db.prepare("DELETE FROM subscriptions WHERE id = ?").run(subscriptionId);
    db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
  }
});

test("T6 splits a monthly bill by subscription ownership before and after transfer", () => {
  const oldPhone = uniquePhone("5");
  const newPhone = uniquePhone("6");

  const oldCustomer = db.prepare(
    "INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)"
  ).run(`Old Owner ${oldPhone}`, oldPhone, "Jaipur");
  const newCustomer = db.prepare(
    "INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)"
  ).run(`New Owner ${newPhone}`, newPhone, "Jaipur");

  const oldCustomerId = Number(oldCustomer.lastInsertRowid);
  const newCustomerId = Number(newCustomer.lastInsertRowid);
  const subscription = db.prepare(
    `INSERT INTO subscriptions (customer_id, plan_name, monthly_price, start_date, active)
     VALUES (?, ?, ?, ?, 1)`
  ).run(oldCustomerId, "Monthly Lunch", 3000, "2026-09-01");
  const subscriptionId = Number(subscription.lastInsertRowid);

  try {
    db.prepare(
      `INSERT INTO subscription_transfers
       (subscription_id, from_customer_id, to_customer_id, effective_date)
       VALUES (?, ?, ?, ?)`
    ).run(subscriptionId, oldCustomerId, newCustomerId, "2026-09-15");
    db.prepare("UPDATE subscriptions SET customer_id = ? WHERE id = ?").run(newCustomerId, subscriptionId);

    const oldBill = getCustomerBill(oldCustomerId, "2026-09");
    const newBill = getCustomerBill(newCustomerId, "2026-09");

    assert.equal(oldBill.billing.service_days, 10);
    assert.equal(oldBill.billing.amount, 1363.64);
    assert.equal(newBill.billing.service_days, 12);
    assert.equal(newBill.billing.amount, 1636.36);
    assert.equal(Number((oldBill.billing.amount + newBill.billing.amount).toFixed(2)), 3000);
  } finally {
    db.prepare("DELETE FROM subscription_transfers WHERE subscription_id = ?").run(subscriptionId);
    db.prepare("DELETE FROM subscriptions WHERE id = ?").run(subscriptionId);
    db.prepare("DELETE FROM customers WHERE id IN (?, ?)").run(oldCustomerId, newCustomerId);
  }
});
