import { supabase } from "../lib/supabase";

/**
 * Submit a public loan application.
 *
 * The actual database insert is handled by the
 * Supabase submit_loan_application RPC.
 */
export async function addLoanApplication(applicationData) {
  const {
    first_name,
    last_name,
    cellphone,
    email,
    physical_address,
    employer,
    employment_status,
    monthly_income,
    other_income,
    bank_name,
    account_number,
    amount_requested,
    loan_purpose,
    preferred_payment_date,
    collection_preference,
    notes,
  } = applicationData;

  const { data, error } = await supabase.rpc(
    "submit_loan_application",
    {
      p_first_name: first_name,
      p_last_name: last_name,
      p_cellphone: cellphone,
      p_email: email || null,
      p_physical_address: physical_address || null,
      p_employer: employer || null,
      p_employment_status: employment_status || null,
      p_monthly_income:
        monthly_income !== "" &&
        monthly_income !== null &&
        monthly_income !== undefined
          ? Number(monthly_income)
          : null,
      p_other_income:
        other_income !== "" &&
        other_income !== null &&
        other_income !== undefined
          ? Number(other_income)
          : null,
      p_bank_name: bank_name,
      p_account_number: account_number,
      p_amount_requested: Number(amount_requested),
      p_loan_purpose: loan_purpose || null,
      p_preferred_payment_date:
        preferred_payment_date || null,
      p_collection_preference:
        collection_preference || null,
      p_notes: notes || null,
    }
  );

  if (error) {
    console.error(
      "Error submitting loan application:",
      error
    );

    throw error;
  }

  return data;
}

/**
 * Get all loan applications.
 *
 * This is used by the administrator Applications page.
 */
export async function getLoanApplications() {
  const { data, error } = await supabase
    .from("loan_applications")
    .select("*")
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error(
      "Error loading loan applications:",
      error
    );

    throw error;
  }

  return data || [];
}

/**
 * Get one loan application.
 */
export async function getLoanApplication(id) {
  if (!id) {
    throw new Error("Application ID is required.");
  }

  const { data, error } = await supabase
    .from("loan_applications")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error(
      "Error loading loan application:",
      error
    );

    throw error;
  }

  return data;
}

/**
 * Update application status.
 */
export async function updateLoanApplicationStatus(
  id,
  status
) {
  if (!id) {
    throw new Error("Application ID is required.");
  }

  if (!status) {
    throw new Error("Application status is required.");
  }

  const { data, error } = await supabase
    .from("loan_applications")
    .update({
      status,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(
      "Error updating application status:",
      error
    );

    throw error;
  }

  return data;
}

/**
 * Delete an application.
 *
 * Intended for administrator use.
 */
export async function deleteLoanApplication(id) {
  if (!id) {
    throw new Error("Application ID is required.");
  }

  const { error } = await supabase
    .from("loan_applications")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(
      "Error deleting loan application:",
      error
    );

    throw error;
  }

  return true;
}
