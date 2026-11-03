import { supabase } from "../lib/supabase";

export async function requestLoanTopUp(loanId, amount) {
  const { data, error } = await supabase.rpc("request_loan_top_up", {
    p_loan_id: loanId,
    p_amount: Number(amount),
  });
  if (error) throw error;
  return data;
}

export async function getLoanTopUpRequests() {
  const { data, error } = await supabase
    .from("loan_top_up_requests")
    .select(`
      *,
      loans(loan_number, current_balance, principal_amount, customers(first_name,last_name,customer_number))
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function approveLoanTopUp(requestId) {
  const { data, error } = await supabase.rpc("approve_loan_top_up", {
    p_request_id: requestId,
  });
  if (error) throw error;
  return data;
}

export async function rejectLoanTopUp(requestId, reason = "") {
  const { error } = await supabase.rpc("reject_loan_top_up", {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function processLoanTopUpFundingQueue() {
  const { data, error } = await supabase.rpc("process_loan_top_up_funding_queue");
  if (error) throw error;
  return data;
}
