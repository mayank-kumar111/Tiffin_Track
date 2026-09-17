const db = require("../db");

function isWeekday(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getDueCustomers(deliveryDate) {
  if (!validateDate(deliveryDate)) throw new Error("deliveryDate must use YYYY-MM-DD format");
  if (!isWeekday(deliveryDate)) return [];

  return db.prepare(
    `SELECT c.id, c.name, c.phone, s.id AS subscription_id, s.plan_name
     FROM customers c
     INNER JOIN subscriptions s ON s.customer_id = c.id AND s.active = 1
     WHERE s.start_date <= ?
       AND NOT EXISTS (
         SELECT 1
         FROM pause_periods p
         WHERE p.customer_id = c.id
           AND p.pause_start <= ?
           AND (p.resume_date IS NULL OR p.resume_date > ?)
       )
     ORDER BY c.name ASC`
  ).all(deliveryDate, deliveryDate, deliveryDate);
}

function notifyDueCustomers(deliveryDate) {
  const dueCustomers = getDueCustomers(deliveryDate);
  const insertOutbox = db.prepare(
    `INSERT OR IGNORE INTO notification_outbox
      (customer_id, subscription_id, delivery_date, channel, message)
     VALUES (?, ?, ?, 'notification_service', ?)`
  );

  const runTransaction = db.transaction((customers) => {
    const outbox = [];
    let deduped = 0;

    for (const customer of customers) {
      const message = `Tiffin delivery due today for ${customer.name}`;
      const result = insertOutbox.run(
        customer.id,
        customer.subscription_id,
        deliveryDate,
        message
      );

      if (result.changes) {
        outbox.push({
          customer_id: customer.id,
          subscription_id: customer.subscription_id,
          delivery_date: deliveryDate,
          channel: "notification_service",
          message
        });
      } else {
        deduped += 1;
      }
    }

    return { outbox, deduped };
  });

  const result = runTransaction(dueCustomers);

  return {
    delivery_date: deliveryDate,
    weekday: isWeekday(deliveryDate),
    sent: result.outbox.length,
    deduped: result.deduped,
    outbox: result.outbox
  };
}

module.exports = {
  notifyDueCustomers,
  getDueCustomers,
  validateDate,
  isWeekday
};
