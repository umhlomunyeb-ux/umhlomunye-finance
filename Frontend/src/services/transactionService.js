import { supabase } from "../lib/supabase";

export async function getLoanTransactions(loanId) {
  const { data, error } = await supabase
    .from("loan_transactions")
    .select("*")
    .eq("loan_id", loanId)
    .order("transaction_date", { ascending: false });

  if (error) throw error;

  return data;
}