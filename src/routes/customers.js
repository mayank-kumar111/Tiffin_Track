const express = require("express");
const db = require("../db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken);

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/[\s()-]/g, "");
}

router.post("/", (req, res) => {
  try {
    const { name, phone, address = null } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!name || !normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Customer name and phone are required"
      });
    }

    if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
      return res.status(400).json({
        success: false,
        message: "Phone number must contain 7 to 15 digits/characters"
      });
    }

    const existing = db
      .prepare("SELECT id FROM customers WHERE phone = ?")
      .get(normalizedPhone);

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A customer with this phone number already exists",
        customer_id: existing.id
      });
    }

    const result = db
      .prepare("INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)")
      .run(name.trim(), normalizedPhone, address ? String(address).trim() : null);

    const customer = db
      .prepare("SELECT id, name, phone, address, created_at FROM customers WHERE id = ?")
      .get(result.lastInsertRowid);

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      customer
    });
  } catch (error) {
    console.error("Create customer error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create customer"
    });
  }
});

router.get("/", (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 10, 1),
      100
    );
    const search = String(req.query.search || "").trim();
    const sortMap = {
      name: "name",
      phone: "phone",
      created_at: "created_at"
    };
    const sort = sortMap[req.query.sort] || "created_at";
    const order = String(req.query.order || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const offset = (page - 1) * limit;

    let where = "";
    const params = [];

    if (search) {
      where = "WHERE name LIKE ? OR phone LIKE ?";
      params.push(`%${search}%`, `%${search}%`);
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM customers ${where}`)
      .get(...params);

    const customers = db
      .prepare(
        `SELECT id, name, phone, address, created_at
         FROM customers
         ${where}
         ORDER BY ${sort} ${order}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    const total = totalRow.total;
    const totalPages = Math.ceil(total / limit);

    return res.json({
      success: true,
      data: customers,
      pagination: {
        page,
        limit,
        total,
        totalPages
      },
      sorting: {
        sort,
        order: order.toLowerCase()
      },
      search: search || null
    });
  } catch (error) {
    console.error("List customers error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch customers"
    });
  }
});

router.get("/:id", (req, res) => {
  const customer = db
    .prepare("SELECT id, name, phone, address, created_at FROM customers WHERE id = ?")
    .get(req.params.id);

  if (!customer) {
    return res.status(404).json({
      success: false,
      message: "Customer not found"
    });
  }

  return res.json({
    success: true,
    customer
  });
});

router.put("/:id", (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const customer = db
      .prepare("SELECT id FROM customers WHERE id = ?")
      .get(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    const normalizedPhone = phone !== undefined
      ? normalizePhone(phone)
      : undefined;

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer name cannot be empty"
      });
    }

    if (normalizedPhone !== undefined && (normalizedPhone.length < 7 || normalizedPhone.length > 15)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must contain 7 to 15 digits/characters"
      });
    }

    if (normalizedPhone !== undefined) {
      const duplicate = db
        .prepare("SELECT id FROM customers WHERE phone = ? AND id != ?")
        .get(normalizedPhone, req.params.id);

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Another customer already uses this phone number"
        });
      }
    }

    const current = db
      .prepare("SELECT name, phone, address FROM customers WHERE id = ?")
      .get(req.params.id);

    db.prepare(
      `UPDATE customers
       SET name = ?, phone = ?, address = ?
       WHERE id = ?`
    ).run(
      name !== undefined ? String(name).trim() : current.name,
      normalizedPhone !== undefined ? normalizedPhone : current.phone,
      address !== undefined ? (address ? String(address).trim() : null) : current.address,
      req.params.id
    );

    const updated = db
      .prepare("SELECT id, name, phone, address, created_at FROM customers WHERE id = ?")
      .get(req.params.id);

    return res.json({
      success: true,
      message: "Customer updated successfully",
      customer: updated
    });
  } catch (error) {
    console.error("Update customer error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update customer"
    });
  }
});

module.exports = router;
