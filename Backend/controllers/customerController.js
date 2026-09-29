const { query } = require("../config/database");

function sanitizeCustomer(customer) {
  if (!customer) {
    return null;
  }

  return customer;
}

async function getCustomers(req, res) {
  try {
    const status =
      String(req.query?.status || "active")
        .trim()
        .toLowerCase();

    let whereClause = "";
    const params = [];

    if (status === "active") {
      whereClause = `
        WHERE is_active = true
          AND is_deleted = false
      `;
    }

    if (status === "inactive") {
      whereClause = `
        WHERE is_active = false
          AND is_deleted = true
      `;
    }

    const result = await query(
      `
        SELECT *
        FROM public.customers
        ${whereClause}
        ORDER BY created_at DESC
      `,
      params
    );

    return res.json({
      success: true,
      customers: result.rows.map(
        sanitizeCustomer
      ),
    });
  } catch (error) {
    console.error(
      "GET CUSTOMERS ERROR:",
      error
    );

    return res.status(500).json({
      error: "Unable to load customers.",
    });
  }
}

async function getCustomerById(req, res) {
  try {
    const { customerId } = req.params;

    const result = await query(
      `
        SELECT *
        FROM public.customers
        WHERE id = $1
        LIMIT 1
      `,
      [customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    return res.json({
      success: true,
      customer: sanitizeCustomer(
        result.rows[0]
      ),
    });
  } catch (error) {
    console.error(
      "GET CUSTOMER ERROR:",
      error
    );

    return res.status(500).json({
      error: "Unable to load customer.",
    });
  }
}

async function createCustomer(req, res) {
  try {
    const customer = req.body || {};

    const firstName =
      String(customer.first_name || "").trim();

    const lastName =
      String(customer.last_name || "").trim();

    const idNumber =
      String(customer.id_number || "").trim();

    const cellphone =
      String(customer.cellphone || "").trim();

    if (!firstName) {
      return res.status(400).json({
        error: "First name is required.",
      });
    }

    if (!lastName) {
      return res.status(400).json({
        error: "Last name is required.",
      });
    }

    if (!idNumber) {
      return res.status(400).json({
        error: "ID number is required.",
      });
    }

    if (!cellphone) {
      return res.status(400).json({
        error: "Cellphone is required.",
      });
    }

    const duplicate =
      await query(
        `
          SELECT id
          FROM public.customers
          WHERE id_number = $1
          LIMIT 1
        `,
        [idNumber]
      );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        error: "Customer already exists.",
      });
    }

    let customerNumber =
      String(
        customer.customer_number || ""
      ).trim();

    if (!customerNumber) {
      const numberResult =
        await query(
          `
            SELECT customer_number
            FROM public.customers
            WHERE customer_number IS NOT NULL
            ORDER BY customer_number DESC
            LIMIT 1
          `
        );

      if (
        numberResult.rows.length === 0
      ) {
        customerNumber = "CUS000001";
      } else {
        const lastNumber = parseInt(
          String(
            numberResult.rows[0]
              .customer_number
          ).replace(/^CUS/i, ""),
          10
        );

        customerNumber =
          `CUS${String(
            Number.isFinite(lastNumber)
              ? lastNumber + 1
              : 1
          ).padStart(6, "0")}`;
      }
    }

    const result =
      await query(
        `
          INSERT INTO public.customers (
            customer_number,
            first_name,
            last_name,
            id_number,
            date_of_birth,
            gender,
            cellphone,
            email,
            physical_address,
            occupation,
            employer,
            monthly_income,
            is_active,
            is_deleted,
            created_by
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            true,
            false,
            $13
          )
          RETURNING *
        `,
        [
          customerNumber,
          firstName,
          lastName,
          idNumber,
          customer.date_of_birth || null,
          customer.gender || null,
          cellphone,
          customer.email || null,
          customer.physical_address || null,
          customer.occupation || null,
          customer.employer || null,
          customer.monthly_income === ""
            ? null
            : customer.monthly_income ?? null,
          req.user?.sub || null,
        ]
      );

    return res.status(201).json({
      success: true,
      customer:
        sanitizeCustomer(
          result.rows[0]
        ),
    });
  } catch (error) {
    console.error(
      "CREATE CUSTOMER ERROR:",
      error
    );

    return res.status(500).json({
      error: "Unable to create customer.",
    });
  }
}

async function updateCustomer(req, res) {
  try {
    const { customerId } =
      req.params;

    const customer =
      req.body || {};

    const result =
      await query(
        `
          UPDATE public.customers
          SET
            customer_number = COALESCE(
              $1,
              customer_number
            ),
            first_name = COALESCE(
              $2,
              first_name
            ),
            last_name = COALESCE(
              $3,
              last_name
            ),
            id_number = COALESCE(
              $4,
              id_number
            ),
            date_of_birth = $5,
            gender = $6,
            cellphone = COALESCE(
              $7,
              cellphone
            ),
            email = $8,
            physical_address = $9,
            occupation = $10,
            employer = $11,
            monthly_income = $12,
            postal_address = $13,
            alternative_phone = $14,
            updated_at = NOW()
          WHERE id = $15
          RETURNING *
        `,
        [
          customer.customer_number || null,
          customer.first_name || null,
          customer.last_name || null,
          customer.id_number || null,
          customer.date_of_birth || null,
          customer.gender || null,
          customer.cellphone || null,
          customer.email || null,
          customer.physical_address || null,
          customer.occupation || null,
          customer.employer || null,
          customer.monthly_income === ""
            ? null
            : customer.monthly_income ?? null,
          customer.postal_address || null,
          customer.alternative_phone || null,
          customerId,
        ]
      );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    return res.json({
      success: true,
      customer:
        sanitizeCustomer(
          result.rows[0]
        ),
    });
  } catch (error) {
    console.error(
      "UPDATE CUSTOMER ERROR:",
      error
    );

    return res.status(500).json({
      error: "Unable to update customer.",
    });
  }
}

async function deleteCustomer(req, res) {
  try {
    const { customerId } =
      req.params;

    const result =
      await query(
        `
          DELETE FROM public.customers
          WHERE id = $1
          RETURNING id
        `,
        [customerId]
      );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    return res.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "DELETE CUSTOMER ERROR:",
      error
    );

    return res.status(500).json({
      error: "Unable to delete customer.",
    });
  }
}

async function generateCustomerNumber(
  req,
  res
) {
  try {
    const result =
      await query(
        `
          SELECT customer_number
          FROM public.customers
          WHERE customer_number IS NOT NULL
          ORDER BY customer_number DESC
          LIMIT 1
        `
      );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        customer_number:
          "CUS000001",
      });
    }

    const lastNumber =
      parseInt(
        String(
          result.rows[0]
            .customer_number
        ).replace(/^CUS/i, ""),
        10
      );

    const nextNumber =
      Number.isFinite(lastNumber)
        ? lastNumber + 1
        : 1;

    return res.json({
      success: true,
      customer_number:
        `CUS${String(
          nextNumber
        ).padStart(6, "0")}`,
    });
  } catch (error) {
    console.error(
      "GENERATE CUSTOMER NUMBER ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to generate customer number.",
    });
  }
}

async function customerExists(req, res) {
  try {
    const idNumber =
      String(
        req.query?.id_number || ""
      ).trim();

    if (!idNumber) {
      return res.json({
        success: true,
        exists: false,
      });
    }

    const result =
      await query(
        `
          SELECT id
          FROM public.customers
          WHERE id_number = $1
          LIMIT 1
        `,
        [idNumber]
      );

    return res.json({
      success: true,
      exists:
        result.rows.length > 0,
    });
  } catch (error) {
    console.error(
      "CUSTOMER EXISTS ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to check customer.",
    });
  }
}

async function findCustomerByIdNumber(
  req,
  res
) {
  try {
    const idNumber =
      String(
        req.query?.id_number || ""
      ).trim();

    if (!idNumber) {
      return res.json({
        success: true,
        customer: null,
      });
    }

    const result =
      await query(
        `
          SELECT
            id,
            customer_number,
            first_name,
            last_name,
            id_number,
            cellphone,
            email,
            date_of_birth,
            gender,
            employer,
            occupation,
            monthly_income,
            physical_address,
            postal_address,
            alternative_phone,
            is_active,
            is_deleted
          FROM public.customers
          WHERE id_number = $1
          LIMIT 1
        `,
        [idNumber]
      );

    return res.json({
      success: true,
      customer:
        result.rows[0] || null,
    });
  } catch (error) {
    console.error(
      "FIND CUSTOMER BY ID ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to find customer.",
    });
  }
}

async function findCustomerByDetails(
  req,
  res
) {
  try {
    const idNumber =
      String(
        req.query?.id_number || ""
      ).trim();

    const cellphone =
      String(
        req.query?.cellphone || ""
      ).trim();

    if (idNumber) {
      const result =
        await query(
          `
            SELECT *
            FROM public.customers
            WHERE id_number = $1
            LIMIT 1
          `,
          [idNumber]
        );

      if (result.rows.length > 0) {
        return res.json({
          success: true,
          customer:
            result.rows[0],
        });
      }
    }

    if (cellphone) {
      const result =
        await query(
          `
            SELECT *
            FROM public.customers
            WHERE cellphone = $1
            LIMIT 1
          `,
          [cellphone]
        );

      if (result.rows.length > 0) {
        return res.json({
          success: true,
          customer:
            result.rows[0],
        });
      }
    }

    return res.json({
      success: true,
      customer: null,
    });
  } catch (error) {
    console.error(
      "FIND CUSTOMER BY DETAILS ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to find customer.",
    });
  }
}

async function deactivateCustomer(
  req,
  res
) {
  try {
    const { customerId } =
      req.params;

    const result =
      await query(
        `
          UPDATE public.customers
          SET
            is_active = false,
            is_deleted = true,
            deleted_at = NOW(),
            deleted_by = $1,
            updated_at = NOW()
          WHERE id = $2
          RETURNING *
        `,
        [
          req.user?.sub || null,
          customerId,
        ]
      );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    return res.json({
      success: true,
      customer:
        result.rows[0],
    });
  } catch (error) {
    console.error(
      "DEACTIVATE CUSTOMER ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to deactivate customer.",
    });
  }
}

async function reactivateCustomer(
  req,
  res
) {
  try {
    const { customerId } =
      req.params;

    const result =
      await query(
        `
          UPDATE public.customers
          SET
            is_active = true,
            is_deleted = false,
            deleted_at = NULL,
            deleted_by = NULL,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [customerId]
      );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Customer not found.",
      });
    }

    return res.json({
      success: true,
      customer:
        result.rows[0],
    });
  } catch (error) {
    console.error(
      "REACTIVATE CUSTOMER ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to reactivate customer.",
    });
  }
}

module.exports = {
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
};