import { supabase } from "../lib/supabase";


/* =========================================================
   HELPERS
========================================================= */

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}


function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}


/* =========================================================
   GET LOAN TRANSACTIONS
========================================================= */

export async function getLoanTransactions(loanId) {
  if (!loanId) {
    throw new Error(
      "Loan ID is required."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("loan_transactions")
    .select("*")
    .eq("loan_id", loanId)
    .order("transaction_date", {
      ascending: true,
    })
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    console.error(
      "GET LOAN TRANSACTIONS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load loan transactions."
      )
    );
  }

  return data || [];
}


/* =========================================================
   GET SINGLE TRANSACTION
========================================================= */

export async function getLoanTransaction(
  transactionId
) {
  if (!transactionId) {
    throw new Error(
      "Transaction ID is required."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("loan_transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (error) {
    console.error(
      "GET LOAN TRANSACTION ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load transaction."
      )
    );
  }

  return data;
}


/* =========================================================
   GET TRANSACTION TOTALS
========================================================= */

export async function getLoanTransactionTotals(
  loanId
) {
  const transactions =
    await getLoanTransactions(
      loanId
    );

  const totalDebit =
    transactions.reduce(
      (sum, transaction) =>
        sum +
        toNumber(transaction.debit),
      0
    );

  const totalCredit =
    transactions.reduce(
      (sum, transaction) =>
        sum +
        toNumber(transaction.credit),
      0
    );

  return {
    totalDebit,
    totalCredit,
    transactionCount:
      transactions.length,
  };
}


/* =========================================================
   GET LATEST TRANSACTION
========================================================= */

export async function getLatestLoanTransaction(
  loanId
) {
  if (!loanId) {
    throw new Error(
      "Loan ID is required."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("loan_transactions")
    .select("*")
    .eq("loan_id", loanId)
    .order("transaction_date", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "GET LATEST LOAN TRANSACTION ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load latest transaction."
      )
    );
  }

  return data || null;
}


/* =========================================================
   GET RECENT TRANSACTIONS
========================================================= */

export async function getRecentTransactions(
  limit = 20
) {
  const safeLimit = Math.max(
    Number(limit) || 20,
    1
  );

  const {
    data,
    error,
  } = await supabase
    .from("loan_transactions")
    .select("*")
    .order("transaction_date", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    })
    .limit(safeLimit);

  if (error) {
    console.error(
      "GET RECENT TRANSACTIONS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load recent transactions."
      )
    );
  }

  return data || [];
}


/* =========================================================
   GET RECENT TRANSACTIONS WITH LOAN
========================================================= */

export async function getRecentLoanTransactions(
  limit = 20
) {
  const safeLimit = Math.max(
    Number(limit) || 20,
    1
  );

  const {
    data,
    error,
  } = await supabase
    .from("loan_transactions")
    .select(`
      *,
      loans (
        id,
        loan_number,
        customer_id,
        customers (
          customer_number,
          first_name,
          last_name
        )
      )
    `)
    .order("transaction_date", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    })
    .limit(safeLimit);

  if (error) {
    console.error(
      "GET RECENT LOAN TRANSACTIONS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load recent loan transactions."
      )
    );
  }

  return data || [];
}


/* =========================================================
   DEFAULT EXPORT
========================================================= */

const transactionService = {
  getLoanTransactions,
  getLoanTransaction,
  getLoanTransactionTotals,
  getLatestLoanTransaction,
  getRecentTransactions,
  getRecentLoanTransactions,
};


export default transactionService;