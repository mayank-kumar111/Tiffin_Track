const express = require("express");
const cors = require("cors");
require("dotenv").config();
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

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
