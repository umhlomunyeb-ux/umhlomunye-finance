const express = require("express");

const {
  login,
  me,
  logout,
} = require("../controllers/authController");

const {
  authenticateToken,
} = require("../middleware/auth");

const router = express.Router();

router.post("/login", login);

router.get("/me", authenticateToken, me);

router.post("/logout", authenticateToken, logout);

module.exports = router;