const express = require("express");

const {
  authenticateToken,
} = require("../middleware/auth");

const {
  getSettings,
  updateSettings,
} = require("../controllers/settingsController");

const router = express.Router();

router.get("/", authenticateToken, getSettings);

router.put(
  "/",
  authenticateToken,
  updateSettings
);

module.exports = router;