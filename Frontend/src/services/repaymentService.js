import { supabase } from "../lib/supabase";

export async function addRepayment(payment) {
  const { data, error } = await supabase
    .from("repayments")
    .insert([payment])
    .select();

  if (error) throw error;

  return data;
}

export async function getRepayments(loanId) {
  const { data, error } = await supabase
    .from("repayments")
    .select("*")
    .eq("loan_id", loanId)
    .order("payment_date", { ascending: false });

  if (error) throw error;

  return data;
}