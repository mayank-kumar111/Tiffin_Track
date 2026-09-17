const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { JWT_SECRET, authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = db
      .prepare(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
      )
      .run(name.trim(), normalizedEmail, passwordHash);

    const user = db
      .prepare("SELECT id, name, email, created_at FROM users WHERE id = ?")
      .get(result.lastInsertRowid);

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to register user"
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(normalizedEmail);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at
    };

    const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: "2h" });

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to login"
    });
  }
});

router.get("/me", authenticateToken, (req, res) => {
  const user = db
    .prepare("SELECT id, name, email, created_at FROM users WHERE id = ?")
    .get(req.user.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User account not found"
    });
  }

  return res.json({
    success: true,
    user
  });
});

module.exports = router;
