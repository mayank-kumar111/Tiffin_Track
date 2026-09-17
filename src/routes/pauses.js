const express = require("express");
const db = require("../db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

function isValidDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function getActiveSubscription(customerId) {
  return db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE customer_id = ? AND active = 1
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(customerId);
}

function hasPauseOverlap(customerId, pauseStart, resumeDate, ignoreId = null) {
  const rows = db
    .prepare(
      `SELECT id, pause_start, resume_date
       FROM pause_periods
       WHERE customer_id = ?
         AND (? IS NULL OR id != ?)`
    )
    .all(customerId, ignoreId, ignoreId);

  return rows.some((row) => {
    const existingEnd = row.resume_date;
    const newEnd = resumeDate || null;

    const existingEndsAfterNewStart =
      existingEnd === null || existingEnd > pauseStart;

    const newEndsAfterExistingStart =
      newEnd === null || newEnd > row.pause_start;

    return existingEndsAfterNewStart && newEndsAfterExistingStart;
  });
}

router.post("/:customerId/pause", authenticateToken, (req, res) => {
  try {
    const customerId = Number(req.params.customerId);
    const { pauseStart, resumeDate = null } = req.body;

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId"
      });
    }

    const effectivePauseStart = pauseStart || new Date().toISOString().slice(0, 10);

    if (!isValidDate(effectivePauseStart)) {
      return res.status(400).json({
        success: false,
        message: "pauseStart must use YYYY-MM-DD format"
      });
    }

    if (resumeDate !== null && !isValidDate(resumeDate)) {
      return res.status(400).json({
        success: false,
        message: "resumeDate must use YYYY-MM-DD format"
      });
    }

    if (resumeDate !== null && resumeDate <= effectivePauseStart) {
      return res.status(400).json({
        success: false,
        message: "resumeDate must be after pauseStart"
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

    const activeSubscription = getActiveSubscription(customerId);

    if (!activeSubscription) {
      return res.status(409).json({
        success: false,
        message: "Customer does not have an active subscription"
      });
    }

    if (effectivePauseStart < activeSubscription.start_date) {
      return res.status(400).json({
        success: false,
        message: "Pause cannot start before the subscription start date"
      });
    }

    const openPause = db
      .prepare(
        `SELECT id FROM pause_periods
         WHERE customer_id = ? AND resume_date IS NULL
         LIMIT 1`
      )
      .get(customerId);

    if (openPause) {
      return res.status(409).json({
        success: false,
        message: "Customer is already paused"
      });
    }

    if (hasPauseOverlap(customerId, effectivePauseStart, resumeDate)) {
      return res.status(409).json({
        success: false,
        message: "Pause period overlaps an existing pause"
      });
    }

    const result = db
      .prepare(
        `INSERT INTO pause_periods (customer_id, pause_start, resume_date)
         VALUES (?, ?, ?)`
      )
      .run(customerId, effectivePauseStart, resumeDate);

    const pause = db
      .prepare("SELECT * FROM pause_periods WHERE id = ?")
      .get(result.lastInsertRowid);

    return res.status(201).json({
      success: true,
      message: resumeDate ? "Pause period created" : "Customer paused",
      pause
    });
  } catch (error) {
    console.error("Pause creation error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to pause customer"
    });
  }
});

router.post("/:customerId/resume", authenticateToken, (req, res) => {
  try {
    const customerId = Number(req.params.customerId);
    const { resumeDate = new Date().toISOString().slice(0, 10) } = req.body;

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId"
      });
    }

    if (!isValidDate(resumeDate)) {
      return res.status(400).json({
        success: false,
        message: "resumeDate must use YYYY-MM-DD format"
      });
    }

    const activePause = db
      .prepare(
        `SELECT * FROM pause_periods
         WHERE customer_id = ? AND resume_date IS NULL
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(customerId);

    if (!activePause) {
      return res.status(404).json({
        success: false,
        message: "Customer is not currently paused"
      });
    }

    if (resumeDate <= activePause.pause_start) {
      return res.status(400).json({
        success: false,
        message: "resumeDate must be after pauseStart"
      });
    }

    const result = db
      .prepare(
        `UPDATE pause_periods
         SET resume_date = ?
         WHERE id = ? AND resume_date IS NULL`
      )
      .run(resumeDate, activePause.id);

    if (!result.changes) {
      return res.status(409).json({
        success: false,
        message: "Pause could not be resumed"
      });
    }

    const pause = db
      .prepare("SELECT * FROM pause_periods WHERE id = ?")
      .get(activePause.id);

    return res.json({
      success: true,
      message: "Customer resumed",
      pause
    });
  } catch (error) {
    console.error("Resume error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to resume customer"
    });
  }
});

router.get("/:customerId/pauses", authenticateToken, (req, res) => {
  const customerId = Number(req.params.customerId);

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid customerId"
    });
  }

  const pauses = db
    .prepare(
      `SELECT * FROM pause_periods
       WHERE customer_id = ?
       ORDER BY pause_start DESC, id DESC`
    )
    .all(customerId);

  return res.json({
    success: true,
    pauses
  });
});

module.exports = router;
