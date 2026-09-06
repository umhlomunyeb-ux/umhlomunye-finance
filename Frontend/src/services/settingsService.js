import { supabase } from "../lib/supabase";
import { isCurrentUserAdmin } from "./userService";

const DEFAULT_SETTINGS = {
  company_name: "Umhlomunye Finance",

  minimum_loan_amount: 100,
  maximum_loan_amount: 15000,

  tier_1_max_amount: 2000,
  tier_1_interest_rate: 40,

  tier_2_interest_rate: 30,

  maximum_loan_term_months: 6,

  interest_cycle_days: 8,

  currency: "ZAR",
  timezone: "Africa/Johannesburg",
};

/**
 * Get the current system settings.
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
    return DEFAULT_SETTINGS;
  }

  return {
    ...DEFAULT_SETTINGS,
    ...data,
  };
}

/**
 * Update the system settings.
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
    throw new Error(
      "System settings record was not found."
    );
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

  const payload = {
    company_name:
      settings.company_name?.trim() ||
      "Umhlomunye Finance",

    minimum_loan_amount:
      Number(settings.minimum_loan_amount),

    maximum_loan_amount:
      Number(settings.maximum_loan_amount),

    tier_1_max_amount:
      Number(settings.tier_1_max_amount),

    tier_1_interest_rate:
      Number(settings.tier_1_interest_rate),

    tier_2_interest_rate:
      Number(settings.tier_2_interest_rate),

    maximum_loan_term_months:
      Number(
        settings.maximum_loan_term_months
      ),

    interest_cycle_days:
      Number(settings.interest_cycle_days),

    currency:
      settings.currency || "ZAR",

    timezone:
      settings.timezone ||
      "Africa/Johannesburg",

    updated_at:
      new Date().toISOString(),

    updated_by: userId,
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

  return data;
}

/**
 * Determine the applicable interest rate.
 *
 * Default:
 * R100 - R2,000  = 40%
 * Above R2,000   = 30%
 */
export function getInterestRateForAmount(amount, settings) {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const tierLimit = Number(settings?.tier_1_max_amount ?? 2000);
  const tier1Rate = Number(settings?.tier_1_interest_rate ?? 40);
  const tier2Rate = Number(settings?.tier_2_interest_rate ?? 30);

  return value <= tierLimit ? tier1Rate : tier2Rate;
}

export { DEFAULT_SETTINGS };