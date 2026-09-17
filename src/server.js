const express = require("express");
const cors = require("cors");
require("dotenv").config();
const db = require("./db");
const authRoutes = require("./routes/auth");
const customerRoutes = require("./routes/customers");
const subscriptionRoutes = require("./routes/subscriptions");
const pauseRoutes = require("./routes/pauses");
const billRoutes = require("./routes/bills");
const twistRoutes = require("./routes/twists");
const { authenticateToken } = require("./middleware/auth");
const { getCustomerBill, getMonthBounds } = require("./services/billing");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.use("/api/auth", authRoutes);

app.get("/api/customers/:customerId/bill", authenticateToken, (req, res) => {
  const customerId = Number(req.params.customerId);
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ success: false, message: "Invalid customerId" });
  }

  if (!getMonthBounds(month)) {
    return res.status(400).json({ success: false, message: "month must use YYYY-MM format" });
  }

  const customerExists = db.prepare("SELECT id FROM customers WHERE id = ?").get(customerId);
  if (!customerExists) {
    return res.status(404).json({ success: false, message: "Customer not found" });
  }

  const bill = getCustomerBill(customerId, month);
  if (!bill) {
    return res.status(404).json({ success: false, message: "Subscription not found" });
  }

  return res.json({ success: true, ...bill });
});

app.use("/api/customers", customerRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/customers", pauseRoutes);
app.use("/api/bills", billRoutes);

// Assessment twists: expose canonical /clock and /outbox plus /api aliases.
app.use("/", twistRoutes);
app.use("/api", twistRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "TiffinTrack API is running",
    database: db.open ? "connected" : "disconnected"
  });
});

app.listen(PORT, () => {
  console.log(`TiffinTrack server running on port ${PORT}`);
});
