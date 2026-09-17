const db = require("../db");

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
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

function getOwnershipSegments(subscription) {
  const transfers = db.prepare(
    `SELECT * FROM subscription_transfers
     WHERE subscription_id = ?
     ORDER BY effective_date ASC, id ASC`
  ).all(subscription.id);

  let currentOwner = transfers.length ? transfers[0].from_customer_id : subscription.customer_id;
  let currentStart = subscription.start_date;
  const segments = [];

  for (const transfer of transfers) {
    if (transfer.effective_date <= currentStart) continue;
    segments.push({
      customer_id: currentOwner,
      start_date: currentStart,
      end_date_exclusive: transfer.effective_date
    });
    currentOwner = transfer.to_customer_id;
    currentStart = transfer.effective_date;
  }

  segments.push({
    customer_id: currentOwner,
    start_date: currentStart,
    end_date_exclusive: null
  });

  return segments;
}

function getOwnershipIntersection(segment, serviceStart, serviceEnd) {
  const segmentStart = parseDate(segment.start_date);
  if (!segmentStart) return null;

  const segmentEndExclusive = segment.end_date_exclusive
    ? parseDate(segment.end_date_exclusive)
    : new Date(serviceEnd.getTime() + 86400000);
  if (!segmentEndExclusive) return null;

  const overlapStart = new Date(Math.max(segmentStart.getTime(), serviceStart.getTime()));
  const overlapEndInclusive = new Date(
    Math.min(segmentEndExclusive.getTime() - 86400000, serviceEnd.getTime())
  );

  if (overlapStart > overlapEndInclusive) return null;
  return { start: overlapStart, end: overlapEndInclusive };
}

function calculateCustomerShareForSubscription(subscription, customerId, pausePeriods, month) {
  const bounds = getMonthBounds(month);
  if (!bounds) throw new Error("month must use YYYY-MM format");

  const subscriptionStart = parseDate(subscription.start_date);
  if (!subscriptionStart) throw new Error("Invalid subscription start date");

  const serviceStart = new Date(Math.max(subscriptionStart.getTime(), bounds.start.getTime()));
  if (serviceStart > bounds.end) {
    return {
      service_days: 0,
      paused_days: 0,
      served_days: 0,
      amount: 0,
      ownership_segments: []
    };
  }

  const totalServiceDays = getServiceDays(serviceStart, bounds.end);
  const ownershipSegments = getOwnershipSegments(subscription);
  const customerSegments = [];
  let ownedServiceDays = 0;
  let pausedDays = 0;

  for (const segment of ownershipSegments) {
    if (segment.customer_id !== customerId) continue;
    const overlap = getOwnershipIntersection(segment, serviceStart, bounds.end);
    if (!overlap) continue;

    const segmentServiceDays = getServiceDays(overlap.start, overlap.end);
    const segmentPausePeriods = pausePeriods.filter((pause) => pause.customer_id === customerId);
    const segmentPausedDays = getPausedWeekdays(segmentPausePeriods, overlap.start, overlap.end);

    customerSegments.push({
      customer_id: customerId,
      start_date: formatDate(overlap.start),
      end_date: formatDate(overlap.end),
      service_days: segmentServiceDays,
      paused_days: Math.min(segmentPausedDays, segmentServiceDays),
      served_days: Math.max(segmentServiceDays - segmentPausedDays, 0)
    });

    ownedServiceDays += segmentServiceDays;
    pausedDays += Math.min(segmentPausedDays, segmentServiceDays);
  }

  const servedDays = Math.max(ownedServiceDays - pausedDays, 0);
  const monthlyPrice = Number(subscription.monthly_price);
  const amount = totalServiceDays === 0
    ? 0
    : Number(((monthlyPrice * servedDays) / totalServiceDays).toFixed(2));

  return {
    service_days: ownedServiceDays,
    total_cycle_service_days: totalServiceDays,
    paused_days: pausedDays,
    served_days: servedDays,
    amount,
    ownership_segments: customerSegments
  };
}

function calculateBillForSubscription(subscription, pausePeriods, month) {
  const customerId = subscription.customer_id;
  const customerShare = calculateCustomerShareForSubscription(subscription, customerId, pausePeriods, month);
  return {
    month,
    monthly_price: Number(subscription.monthly_price),
    service_days: customerShare.service_days,
    total_cycle_service_days: customerShare.total_cycle_service_days || customerShare.service_days,
    paused_days: customerShare.paused_days,
    served_days: customerShare.served_days,
    amount: customerShare.amount
  };
}

function getCustomerSubscriptionsForBilling(customerId) {
  return db.prepare(
    `SELECT DISTINCT s.*
     FROM subscriptions s
     LEFT JOIN subscription_transfers t ON t.subscription_id = s.id
     WHERE s.customer_id = ?
        OR t.from_customer_id = ?
        OR t.to_customer_id = ?
     ORDER BY s.id DESC`
  ).all(customerId, customerId, customerId);
}

function getCustomerBill(customerId, month) {
  const subscriptions = getCustomerSubscriptionsForBilling(customerId);
  if (!subscriptions.length) return null;

  const pausePeriods = db.prepare(
    `SELECT * FROM pause_periods
     WHERE customer_id = ?
     ORDER BY pause_start ASC`
  ).all(customerId);

  const customer = db
    .prepare("SELECT id, name, phone FROM customers WHERE id = ?")
    .get(customerId);

  const subscriptionBills = subscriptions.map((subscription) => {
    const share = calculateCustomerShareForSubscription(subscription, customerId, pausePeriods, month);
    return {
      subscription: {
        id: subscription.id,
        plan_name: subscription.plan_name,
        monthly_price: Number(subscription.monthly_price),
        start_date: subscription.start_date,
        active: Boolean(subscription.active)
      },
      billing: {
        month,
        monthly_price: Number(subscription.monthly_price),
        service_days: share.service_days,
        total_cycle_service_days: share.total_cycle_service_days || share.service_days,
        paused_days: share.paused_days,
        served_days: share.served_days,
        amount: share.amount,
        ownership_segments: share.ownership_segments
      }
    };
  }).filter((item) => item.billing.service_days > 0 || item.billing.served_days > 0 || item.billing.amount > 0 || item.subscription.active);

  if (!subscriptionBills.length) return null;

  const totalServiceDays = subscriptionBills.reduce((sum, item) => sum + item.billing.service_days, 0);
  const totalPausedDays = subscriptionBills.reduce((sum, item) => sum + item.billing.paused_days, 0);
  const totalServedDays = subscriptionBills.reduce((sum, item) => sum + item.billing.served_days, 0);
  const totalAmount = Number(subscriptionBills.reduce((sum, item) => sum + item.billing.amount, 0).toFixed(2));
  const primary = subscriptionBills[0];

  return {
    customer,
    subscription: primary.subscription,
    subscriptions: subscriptionBills,
    billing: {
      month,
      monthly_price: Number(subscriptionBills.reduce((sum, item) => sum + item.billing.monthly_price, 0).toFixed(2)),
      service_days: totalServiceDays,
      paused_days: totalPausedDays,
      served_days: totalServedDays,
      amount: totalAmount,
      transfer_aware: subscriptionBills.some((item) => item.billing.ownership_segments.length > 0)
    }
  };
}

module.exports = {
  getMonthBounds,
  calculateBillForSubscription,
  calculateCustomerShareForSubscription,
  getOwnershipSegments,
  getCustomerBill
};
