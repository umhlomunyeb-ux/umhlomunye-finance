const express = require("express");

const {
  authenticateToken,
} = require("../middleware/auth");

const {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  generateCustomerNumber,
  customerExists,
  findCustomerByIdNumber,
  findCustomerByDetails,
  deactivateCustomer,
  reactivateCustomer,
} = require("../controllers/customerController");

const router = express.Router();

router.use(authenticateToken);

router.get("/", getCustomers);

router.get(
  "/number",
  generateCustomerNumber
);

router.get(
  "/exists",
  customerExists
);

router.get(
  "/by-id-number",
  findCustomerByIdNumber
);

router.get(
  "/by-details",
  findCustomerByDetails
);

router.get(
  "/:customerId",
  getCustomerById
);

router.post(
  "/",
  createCustomer
);

router.patch(
  "/:customerId",
  updateCustomer
);

router.delete(
  "/:customerId",
  deleteCustomer
);

router.patch(
  "/:customerId/deactivate",
  deactivateCustomer
);

router.patch(
  "/:customerId/reactivate",
  reactivateCustomer
);

module.exports = router;