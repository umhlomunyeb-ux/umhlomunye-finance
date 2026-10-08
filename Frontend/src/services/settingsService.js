import { supabase } from "../lib/supabase";
import { isCurrentUserAdmin } from "./userService";

const DEFAULT_SETTINGS = {
  // Company identity
  company_name: "",
  short_name: "",

  // Company information
  financial_year_end: null,
  company_address: "",
  company_logo_url: "",
  company_phone: "",
  company_whatsapp: "",
  company_email: "",

  // Derived system identity
  system_name: "",
  mobile_app_name: "",

  // Loan amount rules
  minimum_loan_amount: 100,
  maximum_loan_amount: 15000,

  // Interest-rate rule
  tier_1_interest_rate: 40,

  // Loan-term rule
  maximum_loan_term_months: 1,

  // Interest-cycle rules
  interest_cycle_enabled: true,
  interest_cycle_days: 8,
  interest_cycle_time: "00:01:00",

  // Regional settings
  currency: "ZAR",
  timezone: "Africa/Johannesburg",
};


/**
 * Build the system identity from the registered company information.
 *
 * System name:
 *   Company Name + " LMS"
 *
 * Mobile app name:
 *   Short Name + " LMS"
 *
 * These are derived values and are intentionally not stored
 * as independent database fields.
 */
function buildSystemIdentity(companyName, shortName) {
  const cleanCompanyName =
    typeof companyName === "string"
      ? companyName.trim()
      : "";

  const cleanShortName =
    typeof shortName === "string"
      ? shortName.trim()
      : "";

  return {
    system_name: cleanCompanyName
      ? `${cleanCompanyName} LMS`
      : "",

    mobile_app_name: cleanShortName
      ? `${cleanShortName} LMS`
      : "",
  };
}


/**
 * Normalize the financial year-end month.
 *
 * The database stores this as an integer:
 *
 * 1  = January
 * 2  = February
 * ...
 * 12 = December
 *
 * null means it has not yet been configured.
 */
function normalizeFinancialYearEnd(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const month = Number(value);

  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  return month;
}


/**
 * Get the current system settings.
 *
 * All loan rules must be obtained from this record.
 */
export async function getSystemSettings() {
  const { data, error } = await supabase
    .from("system_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getSystemSettings:", error);
    throw error;
  }

  if (!data) {
    return {
      ...DEFAULT_SETTINGS,
    };
  }

  const companyName =
    typeof data.company_name === "string"
      ? data.company_name.trim()
      : "";

  const shortName =
    typeof data.short_name === "string"
      ? data.short_name.trim()
      : "";

  const identity = buildSystemIdentity(
    companyName,
    shortName
  );

  return {
    ...DEFAULT_SETTINGS,
    ...data,

    company_name:
      companyName,

    short_name:
      shortName,

    financial_year_end:
      normalizeFinancialYearEnd(
        data.financial_year_end
      ),

    company_address:
      data.company_address || "",

    company_logo_url:
      data.company_logo_url || "",

    company_phone:
      data.company_phone || "",

    company_whatsapp:
      data.company_whatsapp || "",

    company_email:
      data.company_email || "",

    system_name:
      identity.system_name,

    mobile_app_name:
      identity.mobile_app_name,
  };
}


/**
 * Update the system settings.
 *
 * Only an Administrator may change system settings.
 */
export async function updateSystemSettings(settings) {
  const admin = await isCurrentUserAdmin();

  if (!admin) {
    throw new Error(
      "Only an Administrator can change system settings."
    );
  }

  const current = await getSystemSettings();

  if (!current?.id) {
    const {
      data: userData,
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    const userId = userData?.user?.id || null;

    const companyName =
      settings.company_name?.trim() || "";

    const shortName =
      settings.short_name?.trim() || "";

    const financialYearEnd =
      normalizeFinancialYearEnd(
        settings.financial_year_end
      );

    const initialPayload = {
      company_name: companyName,
      short_name: shortName || null,
      financial_year_end: financialYearEnd,
      company_address:
        settings.company_address?.trim() || null,
      company_logo_url:
        settings.company_logo_url || null,
      company_phone:
        settings.company_phone?.trim() || null,
      company_whatsapp:
        settings.company_whatsapp?.trim() || null,
      company_email:
        settings.company_email?.trim() || null,
      minimum_loan_amount:
        Number(settings.minimum_loan_amount),
      maximum_loan_amount:
        Number(settings.maximum_loan_amount),
      tier_1_interest_rate:
        Number(settings.tier_1_interest_rate),
      maximum_loan_term_months:
        Number(settings.maximum_loan_term_months),
      interest_cycle_enabled:
        Boolean(settings.interest_cycle_enabled),
      interest_cycle_days:
        Number(settings.interest_cycle_days),
      interest_cycle_time:
        settings.interest_cycle_time || null,
      currency:
        settings.currency || "ZAR",
      timezone:
        settings.timezone ||
        "Africa/Johannesburg",
      updated_at:
        new Date().toISOString(),
      updated_by:
        userId,
    };

    const {
      data: created,
      error: createError,
    } = await supabase
      .from("system_settings")
      .insert(initialPayload)
      .select()
      .single();

    if (createError) {
      console.error(
        "createSystemSettings:",
        createError
      );
      throw createError;
    }

    return created;
  }

  const {
    data: userData,
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  const userId =
    userData?.user?.id || null;

  const companyName =
    settings.company_name?.trim() || "";

  const shortName =
    settings.short_name?.trim() || "";

  const financialYearEnd =
    normalizeFinancialYearEnd(
      settings.financial_year_end
    );

  const payload = {
    // ----------------------------------------------------------
    // Company identity
    // ----------------------------------------------------------

    company_name:
      companyName,

    short_name:
      shortName || null,

    // ----------------------------------------------------------
    // Company information
    // ----------------------------------------------------------

    financial_year_end:
      financialYearEnd,

    company_address:
      settings.company_address?.trim() || null,

    company_logo_url:
      settings.company_logo_url || null,

    company_phone:
      settings.company_phone?.trim() || null,

    company_whatsapp:
      settings.company_whatsapp?.trim() || null,

    company_email:
      settings.company_email?.trim() || null,

    // ----------------------------------------------------------
    // Loan amount settings
    // ----------------------------------------------------------

    minimum_loan_amount:
      Number(settings.minimum_loan_amount),

    maximum_loan_amount:
      Number(settings.maximum_loan_amount),

    // ----------------------------------------------------------
    // Interest-rate settings
    // ----------------------------------------------------------

    tier_1_interest_rate:
      Number(settings.tier_1_interest_rate),

    maximum_loan_term_months:
      Number(settings.maximum_loan_term_months),

    // ----------------------------------------------------------
    // Interest-cycle settings
    // ----------------------------------------------------------

    interest_cycle_enabled:
      Boolean(settings.interest_cycle_enabled),

    interest_cycle_days:
      Number(settings.interest_cycle_days),

    interest_cycle_time:
      settings.interest_cycle_time || null,

    // ----------------------------------------------------------
    // Regional settings
    // ----------------------------------------------------------

    currency:
      settings.currency || "ZAR",

    timezone:
      settings.timezone ||
      "Africa/Johannesburg",

    // ----------------------------------------------------------
    // Audit
    // ----------------------------------------------------------

    updated_at:
      new Date().toISOString(),

    updated_by:
      userId,
  };

  const { data, error } =
    await supabase
      .from("system_settings")
      .update(payload)
      .eq("id", current.id)
      .select()
      .single();

  if (error) {
    console.error(
      "updateSystemSettings:",
      error
    );

    throw error;
  }

  const savedCompanyName =
    typeof data.company_name === "string"
      ? data.company_name.trim()
      : "";

  const savedShortName =
    typeof data.short_name === "string"
      ? data.short_name.trim()
      : "";

  const identity =
    buildSystemIdentity(
      savedCompanyName,
      savedShortName
    );

  return {
    ...DEFAULT_SETTINGS,
    ...data,

    company_name:
      savedCompanyName,

    short_name:
      savedShortName,

    financial_year_end:
      normalizeFinancialYearEnd(
        data.financial_year_end
      ),

    company_address:
      data.company_address || "",

    company_logo_url:
      data.company_logo_url || "",

    company_phone:
      data.company_phone || "",

    company_whatsapp:
      data.company_whatsapp || "",

    company_email:
      data.company_email || "",

    system_name:
      identity.system_name,

    mobile_app_name:
      identity.mobile_app_name,
  };
}


/* ============================================================
   MOBILE APP PAIRING
   ============================================================ */


/**
 * Generate a new secure mobile-app pairing credential.
 *
 * The actual token and numeric code are generated inside
 * PostgreSQL and returned only once.
 *
 * Only an authenticated administrator can call this.
 */
export async function createMobilePairing() {
  const admin = await isCurrentUserAdmin();

  if (!admin) {
    throw new Error(
      "Only an Administrator can generate mobile pairing credentials."
    );
  }

  const { data, error } =
    await supabase.rpc(
      "create_mobile_pairing"
    );

  if (error) {
    console.error(
      "createMobilePairing:",
      error
    );

    throw error;
  }

  if (!data) {
    throw new Error(
      "The mobile pairing credentials could not be generated."
    );
  }

  return data;
}


/**
 * Get all mobile devices connected to this LMS.
 */
export async function getMobileDevices() {
  const admin = await isCurrentUserAdmin();

  if (!admin) {
    throw new Error(
      "Only an Administrator can view connected mobile devices."
    );
  }

  const { data, error } =
    await supabase.rpc(
      "get_mobile_devices"
    );

  if (error) {
    console.error(
      "getMobileDevices:",
      error
    );

    throw error;
  }

  return Array.isArray(data)
    ? data
    : [];
}


/**
 * Revoke one mobile device.
 */
export async function revokeMobileDevice(
  deviceId
) {
  const admin = await isCurrentUserAdmin();

  if (!admin) {
    throw new Error(
      "Only an Administrator can revoke a mobile device."
    );
  }

  if (!deviceId) {
    throw new Error(
      "Mobile device ID is required."
    );
  }

  const { data, error } =
    await supabase.rpc(
      "revoke_mobile_device",
      {
        p_device_id: deviceId,
      }
    );

  if (error) {
    console.error(
      "revokeMobileDevice:",
      error
    );

    throw error;
  }

  return data;
}


/**
 * Revoke every mobile device connected to this LMS.
 */
export async function revokeAllMobileDevices() {
  const admin = await isCurrentUserAdmin();

  if (!admin) {
    throw new Error(
      "Only an Administrator can revoke mobile devices."
    );
  }

  const { data, error } =
    await supabase.rpc(
      "revoke_all_mobile_devices"
    );

  if (error) {
    console.error(
      "revokeAllMobileDevices:",
      error
    );

    throw error;
  }

  return data;
}


/* ============================================================
   LOAN RULES
   ============================================================ */


/**
 * Determine the configured interest rate for a loan amount.
 *
 * A single interest rate applies to every loan within the configured range.
 */
export function getInterestRateForAmount(amount, settings) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!settings) throw new Error("Loan settings could not be loaded.");
  const interestRate = Number(settings.tier_1_interest_rate);
  if (!Number.isFinite(interestRate)) throw new Error("Interest-rate settings are incomplete or invalid.");
  return interestRate;
}


/**
 * Determine the applicable loan term from Settings.
 */
export function getLoanTermForAmount(amount, settings) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a valid loan amount.");
  if (!settings) throw new Error("Loan settings could not be loaded.");
  const minimum = Number(settings.minimum_loan_amount);
  const maximum = Number(settings.maximum_loan_amount);
  const termMonths = Number(settings.maximum_loan_term_months);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || !Number.isFinite(termMonths) || termMonths !== 1) throw new Error("Loan term must be exactly 1 month.");
  if (value < minimum) throw new Error("Loan amount must be at least " + minimum + ".");
  if (value > maximum) throw new Error("Loan amount cannot exceed " + maximum + ".");
  return 1;
}


/**
 * Validate the interest-cycle configuration.
 *
 * No business-rule fallback is supplied here.
 * The values must come from Settings.
 */
export function validateInterestCycleSettings(
  settings
) {
  if (!settings) {
    throw new Error(
      "Loan settings could not be loaded."
    );
  }

  const enabled =
    settings.interest_cycle_enabled;

  const days =
    Number(settings.interest_cycle_days);

  const time =
    settings.interest_cycle_time;

  const timezone =
    settings.timezone;

  if (typeof enabled !== "boolean") {
    throw new Error(
      "Interest-cycle enabled setting is invalid."
    );
  }

  if (enabled) {
    if (
      !Number.isFinite(days) ||
      days <= 0
    ) {
      throw new Error(
        "Interest-cycle days setting is incomplete or invalid."
      );
    }

    if (
      typeof time !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(
        time
      )
    ) {
      throw new Error(
        "Interest-cycle time setting is incomplete or invalid."
      );
    }
  }

  if (
    typeof timezone !== "string" ||
    !timezone.trim()
  ) {
    throw new Error(
      "Timezone setting is incomplete or invalid."
    );
  }

  return {
    enabled,
    days,
    time,
    timezone,
  };
}


export { DEFAULT_SETTINGS };