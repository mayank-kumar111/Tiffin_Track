const db = require("../db");

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function getMonthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;

  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) return null;

  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 0));

  return {
    start,
    end,
    startDate: formatDate(start),
    endDate: formatDate(end)
  };
}

function isWeekday(date) {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function getServiceDays(startDate, endDate) {
  let current = new Date(startDate.getTime());
  let count = 0;

  while (current <= endDate) {
    if (isWeekday(current)) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}

function getPausedWeekdays(pausePeriods, periodStart, periodEnd) {
  const pausedDates = new Set();

  for (const pause of pausePeriods) {
    const pauseStart = parseDate(pause.pause_start);
    if (!pauseStart) continue;

    const pauseEndExclusive = pause.resume_date
      ? parseDate(pause.resume_date)
      : new Date(periodEnd.getTime() + 86400000);

    if (!pauseEndExclusive) continue;

    const overlapStart = new Date(Math.max(pauseStart.getTime(), periodStart.getTime()));
    const overlapEndExclusive = new Date(
      Math.min(pauseEndExclusive.getTime(), periodEnd.getTime() + 86400000)
    );

    if (overlapStart >= overlapEndExclusive) continue;

    let current = overlapStart;
    while (current < overlapEndExclusive) {
      if (isWeekday(current)) pausedDates.add(formatDate(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }

  return pausedDates.size;
}

function calculateBillForSubscription(subscription, pausePeriods, month) {
  const bounds = getMonthBounds(month);
  if (!bounds) throw new Error("month must use YYYY-MM format");

  const subscriptionStart = parseDate(subscription.start_date);
  if (!subscriptionStart) throw new Error("Invalid subscription start date");

  const serviceStart = new Date(
    Math.max(subscriptionStart.getTime(), bounds.start.getTime())
  );

  if (serviceStart > bounds.end) {
    return {
      month,
      monthly_price: Number(subscription.monthly_price),
      service_days: 0,
      paused_days: 0,
      served_days: 0,
      amount: 0
    };
  }

  const serviceDays = getServiceDays(serviceStart, bounds.end);
  const pausedDays = getPausedWeekdays(pausePeriods, serviceStart, bounds.end);
  const servedDays = Math.max(serviceDays - pausedDays, 0);
  const monthlyPrice = Number(subscription.monthly_price);
  const amount = serviceDays === 0 ? 0 : Number(((monthlyPrice * servedDays) / serviceDays).toFixed(2));

  return {
    month,
    monthly_price: monthlyPrice,
    service_days: serviceDays,
    paused_days: pausedDays,
    served_days: servedDays,
    amount
  };
}

function getCustomerBill(customerId, month) {
  const subscription = db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE customer_id = ?
       ORDER BY active DESC, id DESC
       LIMIT 1`
    )
    .get(customerId);

  if (!subscription) return null;

  const pausePeriods = db
    .prepare(
      `SELECT * FROM pause_periods
       WHERE customer_id = ?
       ORDER BY pause_start ASC`
    )
    .all(customerId);

  const customer = db
    .prepare("SELECT id, name, phone FROM customers WHERE id = ?")
    .get(customerId);

  return {
    customer,
    subscription: {
      id: subscription.id,
      plan_name: subscription.plan_name,
      monthly_price: Number(subscription.monthly_price),
      start_date: subscription.start_date,
      active: Boolean(subscription.active)
    },
    billing: calculateBillForSubscription(subscription, pausePeriods, month)
  };
}

module.exports = {
  getMonthBounds,
  calculateBillForSubscription,
  getCustomerBill
};
