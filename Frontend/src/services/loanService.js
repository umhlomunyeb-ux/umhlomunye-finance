import { supabase } from "../lib/supabase";

export async function getLoans() {
  const { data, error } = await supabase
    .from("loans")
    .select(`
      *,
      customers (
        customer_number,
        first_name,
        last_name
      )
    `)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data;
}

export async function addLoan(loan) {

  // Save loan
  const { data, error } = await supabase
    .from("loans")
    .insert([loan])
    .select()
    .single();

  if (error) throw error;

  // Create first transaction
  const { error: trxError } = await supabase
    .from("loan_transactions")
    .insert([
      {
        loan_id: data.id,
        transaction_type: "LOAN",
        description: "Loan Issued",
        debit: data.total_repayment,
        credit: 0,
        balance: data.current_balance,
        created_by: null,
      },
    ]);

  if (trxError) throw trxError;

  return data;
}

export async function updateLoan(id, loan) {
  const { data, error } = await supabase
    .from("loans")
    .update(loan)
    .eq("id", id)
    .select();

  if (error) throw error;

  return data;
}

export async function getLoan(id) {
  const { data, error } = await supabase
    .from("loans")
    .select(`
      *,
      customers (
        *
      )
    `)
    .eq("id", id)
    .single();

  if (error) throw error;

  return data;
}
export async function capturePayment(
  loan,
  paymentAmount
) {

  const newBalance =
    Number(loan.current_balance) - Number(paymentAmount);

  const totalPaid =
    Number(loan.total_paid) + Number(paymentAmount);

  const status =
    newBalance <= 0
      ? "Paid"
      : "Active";

  const { data, error } =
    await supabase
      .from("loans")
      .update({
        current_balance: newBalance,
        total_paid: totalPaid,
        loan_status: status,
        last_payment_date: new Date()
      })
      .eq("id", loan.id)
      .select();

  if (error) throw error;

  return data;
}