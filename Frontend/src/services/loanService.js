import { supabase } from "../lib/supabase";
import { createOrUpdateLoanStatement } from "./statementService";

/* =========================================================
   HELPERS
========================================================= */

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/* =========================================================
   GET ALL LOANS
========================================================= */

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
    .eq("is_deleted", false)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error("GET LOANS ERROR:", error);

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load loans."
      )
    );
  }

  return data || [];
}

/* =========================================================
   GET ACTIVE LOANS
========================================================= */

export async function getActiveLoans() {
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
    .eq("loan_status", "Active")
    .eq("is_deleted", false)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error(
      "GET ACTIVE LOANS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load active loans."
      )
    );
  }

  return data || [];
}

/* =========================================================
   GET SINGLE LOAN
========================================================= */

export async function getLoan(id) {
  if (!id) {
    throw new Error("Loan ID is required.");
  }

  const { data, error } = await supabase
    .from("loans")
    .select(`
      *,
      customers (*)
    `)
    .eq("id", id)
    .single();

  if (error) {
    console.error("GET LOAN ERROR:", error);

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load loan."
      )
    );
  }

  return data;
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

  const { data, error } = await supabase
    .from("loan_transactions")
    .select("*")
    .eq("loan_id", loanId)
    .order("transaction_date", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
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
   GENERATE LOAN NUMBER
========================================================= */

export async function generateLoanNumber() {
  const { data, error } = await supabase
    .from("loans")
    .select("loan_number")
    .not("loan_number", "is", null)
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "GENERATE LOAN NUMBER ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to generate loan number."
      )
    );
  }

  let nextNumber = 1;

  if (data?.loan_number) {
    const digits = String(
      data.loan_number
    ).replace(/\D/g, "");

    if (digits) {
      nextNumber =
        Number(digits) + 1;
    }
  }

  return `LN${String(nextNumber).padStart(
    6,
    "0"
  )}`;
}

/* =========================================================
   ADD LOAN
========================================================= */

export async function addLoan(loan) {
  if (!loan) {
    throw new Error(
      "Loan information is required."
    );
  }

  if (!loan.customer_id) {
    throw new Error(
      "Customer is required."
    );
  }

  const principalAmount = toNumber(
    loan.principal_amount
  );

  if (principalAmount <= 0) {
    throw new Error(
      "Loan amount must be greater than zero."
    );
  }

  /* ---------------------------------------------------------
     VERIFY CUSTOMER
  --------------------------------------------------------- */

  const {
    data: customer,
    error: customerError,
  } = await supabase
    .from("customers")
    .select(
      "id, is_active, is_deleted"
    )
    .eq("id", loan.customer_id)
    .single();

  if (customerError) {
    console.error(
      "VERIFY CUSTOMER ERROR:",
      customerError
    );

    throw new Error(
      getErrorMessage(
        customerError,
        "Unable to verify customer."
      )
    );
  }

  if (
    !customer ||
    customer.is_deleted === true ||
    customer.is_active === false
  ) {
    throw new Error(
      "The selected customer is not active."
    );
  }

  /* ---------------------------------------------------------
     GENERATE LOAN NUMBER
  --------------------------------------------------------- */

  const loanNumber =
    await generateLoanNumber();

  /* ---------------------------------------------------------
     NORMALIZE NUMERIC VALUES
  --------------------------------------------------------- */

  const interestRate = toNumber(
    loan.interest_rate
  );

  const interestAmount = toNumber(
    loan.interest_amount
  );

  const totalRepayment = toNumber(
    loan.total_repayment
  );

  const currentBalance =
    toNumber(
      loan.current_balance
    ) || totalRepayment;

  /* ---------------------------------------------------------
     CREATE LOAN
  --------------------------------------------------------- */

  const loanToInsert = {
    ...loan,

    loan_number: loanNumber,

    principal_amount:
      principalAmount,

    interest_rate:
      interestRate,

    interest_amount:
      interestAmount,

    total_repayment:
      totalRepayment,

    current_balance:
      currentBalance,

    loan_status:
      loan.loan_status || "Active",

    is_deleted: false,

    notes:
      loan.notes || null,
  };

  const {
    data,
    error,
  } = await supabase
    .from("loans")
    .insert(loanToInsert)
    .select()
    .single();

  if (error) {
    console.error(
      "ADD LOAN ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to create loan."
      )
    );
  }

  /* ---------------------------------------------------------
     CREATE OPENING LOAN TRANSACTION
  --------------------------------------------------------- */

  const {
    error: transactionError,
  } = await supabase
    .from("loan_transactions")
    .insert({
      loan_id: data.id,
      transaction_date:
        new Date().toISOString(),
      transaction_type:
        "LOAN",
      description:
        "Loan Issued",
      debit:
        principalAmount,
      credit: 0,
      balance:
        currentBalance,
      created_by: null,
    });

  if (transactionError) {
    console.error(
      "OPENING LOAN TRANSACTION ERROR:",
      transactionError
    );

    throw new Error(
      getErrorMessage(
        transactionError,
        "Loan was created but the opening transaction could not be recorded."
      )
    );
  }

  /* ---------------------------------------------------------
     CREATE / UPDATE AUTOMATIC STATEMENT
  --------------------------------------------------------- */

  try {
    await createOrUpdateLoanStatement(
      data.id
    );
  } catch (statementError) {
    /*
     * Statement generation must not undo a
     * successfully created loan.
     */
    console.error(
      "CREATE LOAN STATEMENT ERROR:",
      statementError
    );
  }

  return data;
}

/* =========================================================
   UPDATE LOAN
========================================================= */

export async function updateLoan(
  id,
  loan
) {
  if (!id) {
    throw new Error(
      "Loan ID is required."
    );
  }

  if (!loan) {
    throw new Error(
      "Loan information is required."
    );
  }

  const updateData = {
    ...loan,
    updated_at:
      new Date().toISOString(),
  };

  const {
    data,
    error,
  } = await supabase
    .from("loans")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(
      "UPDATE LOAN ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to update loan."
      )
    );
  }

  return data;
}

/* =========================================================
   VOID LOAN
========================================================= */

export async function voidLoan(id) {
  if (!id) {
    throw new Error(
      "Loan ID is required."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("loans")
    .update({
      loan_status: "Void",
      is_deleted: true,
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(
      "VOID LOAN ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to void loan."
      )
    );
  }

  return data;
}

/* =========================================================
   RECORD REPAYMENT
========================================================= */

export async function addRepayment({
  loanId,
  amount,
  paymentDate,
  notes = "",
}) {
  if (!loanId) {
    throw new Error(
      "Loan ID is required."
    );
  }

  const paymentAmount =
    toNumber(amount);

  if (paymentAmount <= 0) {
    throw new Error(
      "Repayment amount must be greater than zero."
    );
  }

  if (!paymentDate) {
    throw new Error(
      "Payment date is required."
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    "record_loan_payment",
    {
      p_loan_id: loanId,
      p_amount: paymentAmount,
      p_payment_date:
        paymentDate,
      p_notes: notes || "",
    }
  );

  if (error) {
    console.error(
      "RECORD REPAYMENT ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to record repayment."
      )
    );
  }

  /* ---------------------------------------------------------
     UPDATE AUTOMATIC STATEMENT
  --------------------------------------------------------- */

  try {
    await createOrUpdateLoanStatement(
      loanId
    );
  } catch (statementError) {
    /*
     * Statement generation must not cause a
     * successful repayment to fail.
     */
    console.error(
      "UPDATE REPAYMENT STATEMENT ERROR:",
      statementError
    );
  }

  return data;
}

/* =========================================================
   RUN DAILY LOAN PROCESSING
========================================================= */

export async function runDailyLoanProcessing(
  asOf = null
) {
  const rpcArguments = {};

  if (asOf) {
    rpcArguments.p_as_of = asOf;
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    "run_daily_loan_processing",
    rpcArguments
  );

  if (error) {
    console.error(
      "RUN DAILY LOAN PROCESSING ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Failed to run daily loan processing."
      )
    );
  }

  /* ---------------------------------------------------------
     AUTOMATIC STATEMENT UPDATES
     
     The database function now returns the IDs of loans
     that received new INTEREST transactions during this
     processing run.
  --------------------------------------------------------- */

  const statementLoanIds =
    Array.isArray(
      data?.statement_loan_ids
    )
      ? data.statement_loan_ids
      : [];

  if (
    statementLoanIds.length > 0
  ) {
    for (const loanId of statementLoanIds) {
      if (!loanId) {
        continue;
      }

      try {
        await createOrUpdateLoanStatement(
          loanId
        );
      } catch (statementError) {
        /*
         * Statement generation must not cause the
         * successful interest-processing run to fail.
         */
        console.error(
          `UPDATE DAILY INTEREST STATEMENT ERROR FOR LOAN ${loanId}:`,
          statementError
        );
      }
    }
  }

  return data;
}

/* =========================================================
   GET DASHBOARD LOAN SUMMARY
========================================================= */

export async function getLoanSummary() {
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
    .eq("is_deleted", false)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error(
      "GET LOAN SUMMARY ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load loan summary."
      )
    );
  }

  const loans = Array.isArray(data)
    ? data
    : [];

  const activeLoans = loans.filter(
    (loan) =>
      String(
        loan?.loan_status || ""
      ).toLowerCase() === "active" &&
      !loan?.is_deleted
  );

  return {
    /*
     * The complete loan collection is returned
     * because Reports.jsx uses it to build the
     * financial report and portfolio calculations.
     */
    loans,

    totalLoans:
      loans.length,

    activeLoans:
      activeLoans.length,

    totalPrincipal:
      loans.reduce(
        (total, loan) =>
          total +
          toNumber(
            loan?.principal_amount
          ),
        0
      ),

    totalOutstanding:
      activeLoans.reduce(
        (total, loan) =>
          total +
          toNumber(
            loan?.current_balance
          ),
        0
      ),

    totalPaid:
      loans.reduce(
        (total, loan) =>
          total +
          toNumber(
            loan?.total_paid
          ),
        0
      ),

    totalInterest:
      loans.reduce(
        (total, loan) =>
          total +
          toNumber(
            loan?.interest_amount
          ),
        0
      ),
  };
}

/* =========================================================
   GET RECENT TRANSACTIONS
========================================================= */

export async function getRecentTransactions(
  limit = 20
) {
  const { data, error } =
    await supabase
      .from("loan_transactions")
      .select("*")
      .order("transaction_date", {
        ascending: false,
      })
      .order("created_at", {
        ascending: false,
      })
      .limit(limit);

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
   GET RECENT LOAN TRANSACTIONS WITH LOAN NUMBER
========================================================= */

export async function getRecentLoanTransactions(
  limit = 20
) {
  const { data, error } =
    await supabase
      .from("loan_transactions")
      .select(`
        *,
        loans (
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
      .limit(limit);

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
   GET LOANS DUE FOR INTEREST
========================================================= */

export async function getLoansDueForInterest() {
  const { data, error } =
    await supabase
      .from("loans")
      .select(`
        *,
        customers (
          customer_number,
          first_name,
          last_name
        )
      `)
      .eq("loan_status", "Active")
      .eq("is_deleted", false)
      .gt("current_balance", 0)
      .not("next_interest_date", "is", null)
      .order("next_interest_date", {
        ascending: true,
      });

  if (error) {
    console.error(
      "GET LOANS DUE FOR INTEREST ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load loans due for interest."
      )
    );
  }

  return data || [];
}

/* =========================================================
   GET UPCOMING INTEREST
========================================================= */

export async function getUpcomingInterestLoans(
  limit = 20
) {
  const { data, error } =
    await supabase
      .from("loans")
      .select(`
        *,
        customers (
          customer_number,
          first_name,
          last_name
        )
      `)
      .eq("loan_status", "Active")
      .eq("is_deleted", false)
      .gt("current_balance", 0)
      .not("next_interest_date", "is", null)
      .order("next_interest_date", {
        ascending: true,
      })
      .limit(limit);

  if (error) {
    console.error(
      "GET UPCOMING INTEREST LOANS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load upcoming interest loans."
      )
    );
  }

  return data || [];
}

/* =========================================================
   GET LOANS BY CUSTOMER
========================================================= */

export async function getCustomerLoans(
  customerId
) {
  if (!customerId) {
    throw new Error(
      "Customer ID is required."
    );
  }

  const { data, error } =
    await supabase
      .from("loans")
      .select(`
        *,
        customers (
          customer_number,
          first_name,
          last_name
        )
      `)
      .eq("customer_id", customerId)
      .eq("is_deleted", false)
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    console.error(
      "GET CUSTOMER LOANS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load customer loans."
      )
    );
  }

  return data || [];
}

/* =========================================================
   GET LOAN FINANCIAL TOTALS
========================================================= */

export async function getLoanFinancialTotals(
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
    .select(
      "transaction_type, debit, credit"
    )
    .eq("loan_id", loanId);

  if (error) {
    console.error(
      "GET LOAN FINANCIAL TOTALS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to calculate loan financial totals."
      )
    );
  }

  const transactions =
    data || [];

  const totalDebit =
    transactions.reduce(
      (total, transaction) =>
        total +
        toNumber(
          transaction.debit
        ),
      0
    );

  const totalCredit =
    transactions.reduce(
      (total, transaction) =>
        total +
        toNumber(
          transaction.credit
        ),
      0
    );

  const totalInterest =
    transactions
      .filter(
        (transaction) =>
          transaction.transaction_type ===
          "INTEREST"
      )
      .reduce(
        (total, transaction) =>
          total +
          toNumber(
            transaction.debit
          ),
        0
      );

  const totalRepayments =
    transactions
      .filter(
        (transaction) =>
          transaction.transaction_type ===
            "PAYMENT" ||
          transaction.transaction_type ===
            "REPAYMENT"
      )
      .reduce(
        (total, transaction) =>
          total +
          toNumber(
            transaction.credit
          ),
        0
      );

  return {
    totalDebit,
    totalCredit,
    totalInterest,
    totalRepayments,
    transactionCount:
      transactions.length,
  };
}

/* =========================================================
   REALTIME LOAN SUBSCRIPTION
========================================================= */

export function subscribeToLoans(
  callback
) {
  const channel =
    supabase
      .channel(
        "loans-realtime"
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loans",
        },
        (payload) => {
          if (callback) {
            callback(payload);
          }
        }
      )
      .subscribe();

  return channel;
}

/* =========================================================
   REALTIME TRANSACTION SUBSCRIPTION
========================================================= */

export function subscribeToLoanTransactions(
  callback
) {
  const channel =
    supabase
      .channel(
        "loan-transactions-realtime"
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_transactions",
        },
        (payload) => {
          if (callback) {
            callback(payload);
          }
        }
      )
      .subscribe();

  return channel;
}

/* =========================================================
   REALTIME SINGLE LOAN SUBSCRIPTION
========================================================= */

export function subscribeToLoan(
  loanId,
  callback
) {
  if (!loanId) {
    return null;
  }

  const channel =
    supabase
      .channel(
        `loan-${loanId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loans",
          filter: `id=eq.${loanId}`,
        },
        (payload) => {
          if (callback) {
            callback(payload);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_transactions",
          filter: `loan_id=eq.${loanId}`,
        },
        (payload) => {
          if (callback) {
            callback(payload);
          }
        }
      )
      .subscribe();

  return channel;
}

/* =========================================================
   REMOVE REALTIME CHANNEL
========================================================= */

export async function removeLoanSubscription(
  channel
) {
  if (!channel) {
    return;
  }

  try {
    await supabase.removeChannel(
      channel
    );
  } catch (error) {
    console.error(
      "REMOVE LOAN SUBSCRIPTION ERROR:",
      error
    );
  }
}

/* =========================================================
   DEFAULT EXPORT
========================================================= */

const loanService = {
  getLoans,
  getActiveLoans,
  getLoan,
  getLoanTransactions,
  generateLoanNumber,
  addLoan,
  updateLoan,
  voidLoan,
  addRepayment,
  runDailyLoanProcessing,
  getLoanSummary,
  getRecentTransactions,
  getRecentLoanTransactions,
  getLoansDueForInterest,
  getUpcomingInterestLoans,
  getCustomerLoans,
  getLoanFinancialTotals,
  subscribeToLoans,
  subscribeToLoanTransactions,
  subscribeToLoan,
  removeLoanSubscription,
};

export default loanService;