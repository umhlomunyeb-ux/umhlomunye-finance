const express = require("express");

const {
  authenticateToken,
} = require("../middleware/auth");

const {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
} = require("../controllers/userController");

const router = express.Router();

router.use(authenticateToken);

router.get("/", getUsers);

router.post("/", createUser);

router.patch(
  "/:userId",
  updateUser
);

router.delete(
  "/:userId",
  deleteUser
);

module.exports = router;