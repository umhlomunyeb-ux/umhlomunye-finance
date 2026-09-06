import { supabase } from "../lib/supabase";

export async function getLoanTransactions(loanId) {
  const { data, error } = await supabase
    .from("loan_transactions")
    .select("*")
    .eq("loan_id", loanId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}