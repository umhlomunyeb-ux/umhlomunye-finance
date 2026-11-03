import { supabase } from "../lib/supabase";

export async function adminUpdateLoan(loanId, values) {
  if (!loanId) throw new Error("Loan ID is required.");

  const principal = Number(values?.principal_amount);
  const term = Number(values?.term_months);
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new Error("Enter a valid principal amount greater than zero.");
  }
  if (![1, 2].includes(term)) {
    throw new Error("Repayment term must be 1 or 2 months.");
  }
  if (!values?.first_payment_date || !values?.next_payment_date) {
    throw new Error("First and next payment dates are required.");
  }

  const { data, error } = await supabase.rpc("admin_update_loan", {
    p_loan_id: loanId,
    p_principal_amount: principal,
    p_term_months: term,
    p_first_payment_date: values.first_payment_date,
    p_next_payment_date: values.next_payment_date,
    p_notes: values.notes?.trim() || null,
  });
  if (error) throw error;
  return data;
}
