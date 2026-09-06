import { supabase } from "../lib/supabase";

/*
  Bank Service

  All financial movements are recorded in bank_transactions.
  The current balance is calculated from the ledger.

  IN  = money entering the company bank account
  OUT = money leaving the company bank account
*/


// ============================================================
// BANK ACCOUNT
// ============================================================

export async function getBankAccount() {
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getBankAccount:", error);
    throw error;
  }

  return data;
}


// ============================================================
// CURRENT BANK BALANCE
// ============================================================

export async function getBankBalance() {
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("amount, direction")
    .eq("is_void", false);

  if (error) {
    console.error("getBankBalance:", error);
    throw error;
  }

  return (data || []).reduce((balance, transaction) => {
    const amount = Number(transaction.amount || 0);

    return transaction.direction === "IN"
      ? balance + amount
      : balance - amount;
  }, 0);
}


// ============================================================
// BANK TRANSACTIONS
// ============================================================

export async function getBankTransactions() {
  const { data, error } = await supabase
    .from("bank_transactions")
    .select(`
      *,
      bank_accounts (
        account_name
      )
    `)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getBankTransactions:", error);
    throw error;
  }

  return data || [];
}


// ============================================================
// INITIAL COMPANY BALANCE
// ============================================================

export async function createInitialBankBalance({
  accountName = "Company Bank Account",
  bankName = "",
  amount,
  transactionDate,
  description = "Initial company bank balance",
}) {
  const { data, error } = await supabase.rpc(
    "create_initial_bank_balance",
    {
      p_account_name: accountName,
      p_bank_name: bankName || null,
      p_amount: Number(amount),
      p_transaction_date: transactionDate,
      p_description: description,
    }
  );

  if (error) {
    console.error("createInitialBankBalance:", error);
    throw error;
  }

  return data;
}


// ============================================================
// ADD MONEY
// ============================================================

export async function addBankMoney({
  amount,
  transactionDate,
  description,
  reference = "",
}) {
  const { data, error } = await supabase.rpc(
    "add_bank_money",
    {
      p_amount: Number(amount),
      p_transaction_date: transactionDate,
      p_description: description,
      p_reference: reference || null,
    }
  );

  if (error) {
    console.error("addBankMoney:", error);
    throw error;
  }

  return data;
}


// ============================================================
// COMPANY BORROWING
// ============================================================

export async function createCompanyBorrowing({
  lenderName,
  amount,
  borrowingDate,
  description = "",
  reference = "",
}) {
  const { data, error } = await supabase.rpc(
    "create_company_borrowing",
    {
      p_lender_name: lenderName,
      p_amount: Number(amount),
      p_borrowing_date: borrowingDate,
      p_description: description || null,
      p_reference: reference || null,
    }
  );

  if (error) {
    console.error("createCompanyBorrowing:", error);
    throw error;
  }

  return data;
}


// ============================================================
// DEBT REPAYMENT
// ============================================================

export async function repayCompanyDebt({
  borrowingId,
  amount,
  repaymentDate,
  description = "",
  reference = "",
}) {
  const { data, error } = await supabase.rpc(
    "repay_company_debt",
    {
      p_borrowing_id: borrowingId,
      p_amount: Number(amount),
      p_repayment_date: repaymentDate,
      p_description: description || null,
      p_reference: reference || null,
    }
  );

  if (error) {
    console.error("repayCompanyDebt:", error);
    throw error;
  }

  return data;
}


// ============================================================
// BORROWINGS
// ============================================================

export async function getCompanyBorrowings() {
  const { data, error } = await supabase
    .from("company_borrowings")
    .select("*")
    .order("borrowing_date", { ascending: false });

  if (error) {
    console.error("getCompanyBorrowings:", error);
    throw error;
  }

  return data || [];
}


// ============================================================
// BANK SUMMARY
// ============================================================

export async function getBankSummary() {
  const [
    account,
    transactions,
    borrowings,
  ] = await Promise.all([
    getBankAccount(),
    getBankTransactions(),
    getCompanyBorrowings(),
  ]);

  const activeTransactions = transactions.filter(
    (transaction) => !transaction.is_void
  );

  const totalMoneyIn = activeTransactions
    .filter((transaction) => transaction.direction === "IN")
    .reduce(
      (total, transaction) =>
        total + Number(transaction.amount || 0),
      0
    );

  const totalMoneyOut = activeTransactions
    .filter((transaction) => transaction.direction === "OUT")
    .reduce(
      (total, transaction) =>
        total + Number(transaction.amount || 0),
      0
    );

  const outstandingDebt = borrowings
    .filter((borrowing) => borrowing.status !== "Voided")
    .reduce(
      (total, borrowing) =>
        total + Number(borrowing.outstanding_amount || 0),
      0
    );

  return {
    account,
    transactions,
    borrowings,
    totalMoneyIn,
    totalMoneyOut,
    currentBalance: totalMoneyIn - totalMoneyOut,
    outstandingDebt,
  };
};


// ============================================================
// REALTIME
// ============================================================

export function subscribeToBankTransactions(callback) {
  return supabase
    .channel("bank-transactions-realtime")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "bank_transactions",
      },
      callback
    )
    .subscribe();
}

export function removeBankSubscription(channel) {
  if (channel) {
    supabase.removeChannel(channel);
  }
}