const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateBillForSubscription } = require("../src/services/billing");

test("calculates September 2026 bill with three paused weekdays", () => {
  const subscription = {
    monthly_price: 3000,
    start_date: "2026-09-01"
  };

  const pauses = [
    {
      pause_start: "2026-09-14",
      resume_date: "2026-09-17"
    }
  ];

  const result = calculateBillForSubscription(
    subscription,
    pauses,
    "2026-09"
  );

  assert.equal(result.service_days, 22);
  assert.equal(result.paused_days, 3);
  assert.equal(result.served_days, 19);
  assert.equal(result.amount, 2590.91);
});

test("counts only weekdays after a mid-month subscription starts", () => {
  const subscription = {
    monthly_price: 2200,
    start_date: "2026-09-15"
  };

  const result = calculateBillForSubscription(subscription, [], "2026-09");

  assert.equal(result.service_days, 12);
  assert.equal(result.paused_days, 0);
  assert.equal(result.served_days, 12);
  assert.equal(result.amount, 2200);
});
