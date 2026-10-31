import { supabase } from "../lib/supabase";
import { isOfflineMode } from "../config/appMode";

export async function verifyExistingCustomer(customerId, verificationNote = "") {
  if (!customerId) {
    throw new Error("Customer is required.");
  }

  if (isOfflineMode) {
    throw new Error(
      "Existing-client verification is available when Umhlomunye Finance is online."
    );
  }

  const { data, error } = await supabase.rpc(
    "verify_existing_customer",
    {
      p_customer_id: customerId,
      p_verification_note: verificationNote || null,
    }
  );

  if (error) {
    throw error;
  }

  if (!data?.success) {
    throw new Error("The customer could not be verified as an existing client.");
  }

  return data;
}
