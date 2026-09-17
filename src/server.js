const express = require("express");
const cors = require("cors");
require("dotenv").config();
const db = require("./db");
const authRoutes = require("./routes/auth");
const customerRoutes = require("./routes/customers");
const subscriptionRoutes = require("./routes/subscriptions");
const pauseRoutes = require("./routes/pauses");
const billRoutes = require("./routes/bills");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/customers", pauseRoutes);
app.use("/api/bills", billRoutes);

app.get("/api/customers/:customerId/bill", (req, res, next) => {
  req.url = `/api/customers/${req.params.customerId}/bill${req.url.includes("?") ? `?${req.url.split("?")[1]}` : ""}`;
  next();
});

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
