import { supabase } from "../lib/supabase";

export async function getLoanStatement(loanId) {
  if (!loanId) {
    throw new Error("Loan ID is required.");
  }

  const { data: transactions, error: transactionError } = await supabase
    .from("loan_transactions")
    .select("*")
    .eq("loan_id", loanId)
    .order("transaction_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (transactionError) {
    throw transactionError;
  }

  const { data: overdues, error: overdueError } = await supabase
    .from("loan_overdues")
    .select("*")
    .eq("loan_id", loanId)
    .order("cycle_payment_date", { ascending: true });

  if (overdueError) {
    throw overdueError;
  }

  return {
    transactions: transactions || [],
    overdues: overdues || [],
  };
}