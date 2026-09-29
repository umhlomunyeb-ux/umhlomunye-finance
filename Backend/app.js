require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
  testDatabaseConnection,
} = require("./config/database");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const customerRoutes = require("./routes/customerRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use(
  "/api/settings",
  settingsRoutes
);

app.use(
  "/api/users",
  userRoutes
);

app.use(
  "/api/dashboard",
  dashboardRoutes
);

app.use(
  "/api/auth",
  authRoutes
);

app.use(
  "/api/customers", 
  customerRoutes
);

app.get("/", (req, res) => {
  res.json({
    message:
      "Welcome to Umhlomunye Finance Offline Loan Management API",
    version: "1.0.0",
    status: "Running",
    mode: "offline",
  });
});

app.get("/api/health", async (req, res) => {
  try {
    const databaseConnected =
      await testDatabaseConnection();

    res.json({
      status: "ok",
      api: "running",
      database: databaseConnected
        ? "connected"
        : "disconnected",
      mode: "offline",
    });
  } catch (error) {
    console.error(
      "Database health check failed:",
      error
    );

    res.status(503).json({
      status: "error",
      api: "running",
      database: "disconnected",
      mode: "offline",
    });
  }
});

const PORT = Number(
  process.env.PORT || 5000
);

const server = app.listen(
  PORT,
  () => {
    console.log(
      `Offline LMS API running on port ${PORT}`
    );
  }
);

async function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(() => {
    console.log(
      "HTTP server stopped."
    );

    process.exit(0);
  });
}

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);