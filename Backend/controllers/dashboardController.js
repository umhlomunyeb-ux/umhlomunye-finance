const { query } = require("../config/database");

async function getDashboard(req, res) {
  try {
    const [loansResult, transactionsResult, applicationsResult] =
      await Promise.all([
        query(`
          SELECT
            l.*,
            CASE
              WHEN c.id IS NULL THEN NULL
              ELSE json_build_object(
                'customer_number', c.customer_number,
                'first_name', c.first_name,
                'last_name', c.last_name
              )
            END AS customers
          FROM public.loans l
          LEFT JOIN public.customers c
            ON c.id = l.customer_id
          WHERE l.is_deleted = false
          ORDER BY l.created_at DESC
        `),

        query(`
          SELECT *
          FROM public.loan_transactions
          ORDER BY transaction_date DESC
          LIMIT 50
        `),

        query(`
          SELECT *
          FROM public.loan_applications
          WHERE UPPER(status) = 'PENDING'
          ORDER BY created_at DESC
        `),
      ]);

    return res.json({
      success: true,
      loans: loansResult.rows,
      transactions: transactionsResult.rows,
      applications: applicationsResult.rows,
    });
  } catch (error) {
    console.error("GET DASHBOARD ERROR:", error);

    return res.status(500).json({
      error: "Unable to load dashboard data.",
    });
  }
}

module.exports = {
  getDashboard,
};