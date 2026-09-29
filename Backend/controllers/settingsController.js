const { query } = require("../config/database");

async function requireAdmin(req) {
  const userId = req.user?.sub;

  if (!userId) {
    const error = new Error(
      "Authentication required."
    );

    error.status = 401;

    throw error;
  }

  const result = await query(
    `
      SELECT
        id,
        role,
        is_active,
        is_deleted
      FROM public.users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (result.rows.length === 0) {
    const error = new Error(
      "User account not found."
    );

    error.status = 401;

    throw error;
  }

  const user = result.rows[0];

  if (
    String(user.role).toLowerCase() !== "admin" ||
    user.is_active === false ||
    user.is_deleted === true
  ) {
    const error = new Error(
      "Only an Administrator can change system settings."
    );

    error.status = 403;

    throw error;
  }

  return user;
}

async function getSettings(req, res) {
  try {
    const result = await query(
      `
        SELECT *
        FROM public.system_settings
        ORDER BY updated_at DESC
        LIMIT 1
      `
    );

    return res.json({
      success: true,
      settings:
        result.rows[0] || null,
    });
  } catch (error) {
    console.error(
      "GET SYSTEM SETTINGS ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to load system settings.",
    });
  }
}

async function updateSettings(req, res) {
  try {
    await requireAdmin(req);

    const currentResult =
      await query(
        `
          SELECT id
          FROM public.system_settings
          ORDER BY updated_at DESC
          LIMIT 1
        `
      );

    if (
      currentResult.rows.length === 0
    ) {
      return res.status(404).json({
        error:
          "System settings record was not found.",
      });
    }

    const settings =
      req.body || {};

    const currentId =
      currentResult.rows[0].id;

    const companyName =
      String(
        settings.company_name || ""
      ).trim();

    const shortName =
      String(
        settings.short_name || ""
      ).trim();

    const financialYearEnd =
      settings.financial_year_end ===
        null ||
      settings.financial_year_end ===
        undefined ||
      settings.financial_year_end ===
        ""
        ? null
        : Number(
            settings.financial_year_end
          );

    if (
      financialYearEnd !== null &&
      (!Number.isInteger(
        financialYearEnd
      ) ||
        financialYearEnd < 1 ||
        financialYearEnd > 12)
    ) {
      return res.status(400).json({
        error:
          "Financial year-end month must be between 1 and 12.",
      });
    }

    const payload = {
      company_name:
        companyName,

      short_name:
        shortName || null,

      financial_year_end:
        financialYearEnd,

      company_address:
        String(
          settings.company_address || ""
        ).trim() || null,

      company_logo_url:
        settings.company_logo_url ||
        null,

      company_phone:
        String(
          settings.company_phone || ""
        ).trim() || null,

      company_whatsapp:
        String(
          settings.company_whatsapp || ""
        ).trim() || null,

      company_email:
        String(
          settings.company_email || ""
        ).trim() || null,

      minimum_loan_amount:
        Number(
          settings.minimum_loan_amount
        ),

      maximum_loan_amount:
        Number(
          settings.maximum_loan_amount
        ),

      tier_1_max_amount:
        Number(
          settings.tier_1_max_amount
        ),

      tier_1_interest_rate:
        Number(
          settings.tier_1_interest_rate
        ),

      tier_2_interest_rate:
        Number(
          settings.tier_2_interest_rate
        ),

      term_1_max_amount:
        Number(
          settings.term_1_max_amount
        ),

      term_1_months:
        Number(
          settings.term_1_months
        ),

      term_2_max_amount:
        Number(
          settings.term_2_max_amount
        ),

      term_2_months:
        Number(
          settings.term_2_months
        ),

      term_3_months:
        Number(
          settings.term_3_months
        ),

      maximum_loan_term_months:
        Number(
          settings.maximum_loan_term_months
        ),

      interest_cycle_enabled:
        Boolean(
          settings.interest_cycle_enabled
        ),

      interest_cycle_days:
        Number(
          settings.interest_cycle_days
        ),

      interest_cycle_time:
        settings.interest_cycle_time ||
        null,

      currency:
        settings.currency ||
        "ZAR",

      timezone:
        settings.timezone ||
        "Africa/Johannesburg",

      updated_at:
        new Date().toISOString(),

      updated_by:
        req.user.sub,
    };

    const result =
      await query(
        `
          UPDATE public.system_settings
          SET
            company_name = $1,
            short_name = $2,
            financial_year_end = $3,
            company_address = $4,
            company_logo_url = $5,
            company_phone = $6,
            company_whatsapp = $7,
            company_email = $8,
            minimum_loan_amount = $9,
            maximum_loan_amount = $10,
            tier_1_max_amount = $11,
            tier_1_interest_rate = $12,
            tier_2_interest_rate = $13,
            term_1_max_amount = $14,
            term_1_months = $15,
            term_2_max_amount = $16,
            term_2_months = $17,
            term_3_months = $18,
            maximum_loan_term_months = $19,
            interest_cycle_enabled = $20,
            interest_cycle_days = $21,
            interest_cycle_time = $22,
            currency = $23,
            timezone = $24,
            updated_at = $25,
            updated_by = $26
          WHERE id = $27
          RETURNING *
        `,
        [
          payload.company_name,
          payload.short_name,
          payload.financial_year_end,
          payload.company_address,
          payload.company_logo_url,
          payload.company_phone,
          payload.company_whatsapp,
          payload.company_email,
          payload.minimum_loan_amount,
          payload.maximum_loan_amount,
          payload.tier_1_max_amount,
          payload.tier_1_interest_rate,
          payload.tier_2_interest_rate,
          payload.term_1_max_amount,
          payload.term_1_months,
          payload.term_2_max_amount,
          payload.term_2_months,
          payload.term_3_months,
          payload.maximum_loan_term_months,
          payload.interest_cycle_enabled,
          payload.interest_cycle_days,
          payload.interest_cycle_time,
          payload.currency,
          payload.timezone,
          payload.updated_at,
          payload.updated_by,
          currentId,
        ]
      );

    return res.json({
      success: true,
      settings:
        result.rows[0],
    });
  } catch (error) {
    console.error(
      "UPDATE SYSTEM SETTINGS ERROR:",
      error
    );

    return res.status(
      error.status || 500
    ).json({
      error:
        error.message ||
        "Unable to update system settings.",
    });
  }
}

module.exports = {
  getSettings,
  updateSettings,
};