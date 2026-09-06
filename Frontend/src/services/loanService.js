import { supabase } from "../lib/supabase";

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
      getErrorMessage(error, "Unable to load loans.")
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
    .eq("is_deleted", false)
    .eq("loan_status", "Active")
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error("GET ACTIVE LOANS ERROR:", error);
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
      customers (
        *
      )
    `)
    .eq("id", id)
    .single();

  if (error) {
    console.error("GET LOAN ERROR:", error);

    throw new Error(
      getErrorMessage(error, "Unable to load loan.")
    );
  }

  return data;
}


/* =========================================================
   GET LOAN TRANSACTIONS
========================================================= */

export async function getLoanTransactions(loanId) {
  if (!loanId) {
    throw new Error("Loan ID is required.");
  }

  const { data, error } = await supabase
    .from("loan_transactions")
    .select("*")
    .eq("loan_id", loanId)
    .order("transaction_date", {
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
    .order("created_at", {
      ascending: false,
    })
    .limit(1);

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

  if (
    data &&
    data.length > 0 &&
    data[0]?.loan_number
  ) {
    const lastNumber = parseInt(
      String(data[0].loan_number).replace(/\D/g, ""),
      10
    );

    if (!Number.isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  return `LN${String(nextNumber).padStart(6, "0")}`;
}


/* =========================================================
   ADD LOAN
========================================================= */

export async function addLoan(loan) {
  if (!loan) {
    throw new Error("Loan information is required.");
  }

  if (!loan.customer_id) {
    throw new Error("Customer is required.");
  }

  if (
    loan.principal_amount === undefined ||
    loan.principal_amount === null
  ) {
    throw new Error("Principal amount is required.");
  }

  const principalAmount = toNumber(
    loan.principal_amount
  );

  if (principalAmount <= 0) {
    throw new Error(
      "Principal amount must be greater than zero."
    );
  }


  /* ---------------------------------------------
     Verify customer
  --------------------------------------------- */

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
      "CUSTOMER CHECK ERROR:",
      customerError
    );

    throw new Error(
      getErrorMessage(
        customerError,
        "Unable to verify customer."
      )
    );
  }

  if (!customer) {
    throw new Error("Customer not found.");
  }

  if (
    customer.is_active === false ||
    customer.is_deleted === true
  ) {
    throw new Error(
      "This customer is inactive and cannot receive a new loan."
    );
  }


  /* ---------------------------------------------
     Generate loan number
  --------------------------------------------- */

  const loanNumber =
    await generateLoanNumber();


  /* ---------------------------------------------
     Prepare loan data

     notes is deliberately removed because it
     is not part of the loans table.
  --------------------------------------------- */

  const {
    notes,
    ...originalLoanData
  } = loan;

  const loanData = {
    ...originalLoanData,
    loan_number: loanNumber,
  };


  /* ---------------------------------------------
     Ensure numeric values are numeric
  --------------------------------------------- */

  if (
    loanData.principal_amount !== undefined
  ) {
    loanData.principal_amount =
      toNumber(loanData.principal_amount);
  }

  if (
    loanData.interest_rate !== undefined
  ) {
    loanData.interest_rate =
      toNumber(loanData.interest_rate);
  }

  if (
    loanData.interest_amount !== undefined
  ) {
    loanData.interest_amount =
      toNumber(loanData.interest_amount);
  }

  if (
    loanData.total_repayment !== undefined
  ) {
    loanData.total_repayment =
      toNumber(loanData.total_repayment);
  }

  if (
    loanData.current_balance !== undefined
  ) {
    loanData.current_balance =
      toNumber(loanData.current_balance);
  }

  if (
    loanData.total_paid !== undefined
  ) {
    loanData.total_paid =
      toNumber(loanData.total_paid);
  }


  /* ---------------------------------------------
     Insert loan
  --------------------------------------------- */

  const {
    data,
    error,
  } = await supabase
    .from("loans")
    .insert([loanData])
    .select()
    .single();

  if (error) {
    console.error("ADD LOAN ERROR:", error);

    throw new Error(
      getErrorMessage(
        error,
        "Unable to create loan."
      )
    );
  }


  /* ---------------------------------------------
     Create opening transaction
  --------------------------------------------- */

  const {
    error: transactionError,
  } = await supabase
    .from("loan_transactions")
    .insert([
      {
        loan_id: data.id,
        transaction_date:
          new Date().toISOString(),
        transaction_type: "LOAN",
        description: "Loan Issued",
        debit: toNumber(
          data.principal_amount
        ),
        credit: 0,
        balance: toNumber(
          data.current_balance
        ),
        created_by: null,
      },
    ]);

  if (transactionError) {
    console.error(
      "CREATE LOAN TRANSACTION ERROR:",
      transactionError
    );

    throw new Error(
      getErrorMessage(
        transactionError,
        "Loan was created but the opening transaction could not be created."
      )
    );
  }

  return data;
}


/* =========================================================
   UPDATE LOAN
========================================================= */

export async function updateLoan(id, loan) {
  if (!id) {
    throw new Error("Loan ID is required.");
  }

  if (!loan) {
    throw new Error("Loan information is required.");
  }

  const { data, error } = await supabase
    .from("loans")
    .update(loan)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("UPDATE LOAN ERROR:", error);

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
   DELETE / VOID LOAN
========================================================= */

export async function voidLoan(id) {
  if (!id) {
    throw new Error("Loan ID is required.");
  }

  const { data, error } = await supabase
    .from("loans")
    .update({
      loan_status: "Void",
      is_deleted: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("VOID LOAN ERROR:", error);

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
    throw new Error("Loan ID is required.");
  }

  const paymentAmount = Number(amount);

  if (
    !Number.isFinite(paymentAmount) ||
    paymentAmount <= 0
  ) {
    throw new Error(
      "Payment amount must be greater than zero."
    );
  }

  if (!paymentDate) {
    throw new Error(
      "Payment date is required."
    );
  }


  const { data, error } =
    await supabase.rpc(
      "record_loan_payment",
      {
        p_loan_id: loanId,
        p_amount: paymentAmount,
        p_payment_date: paymentDate,
        p_notes: notes || "",
      }
    );

  if (error) {
    console.error(
      "RECORD PAYMENT ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to record the repayment."
      )
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

  const { data, error } =
    await supabase.rpc(
      "run_daily_loan_processing",
      rpcArguments
    );

  if (error) {
    console.error(
      "DAILY LOAN PROCESSING ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to process daily loan interest."
      )
    );
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
      id,
      loan_number,
      principal_amount,
      interest_rate,
      interest_amount,
      total_repayment,
      current_balance,
      total_paid,
      loan_status,
      first_payment_date,
      next_payment_date,
      next_interest_date,
      last_interest_date,
      last_payment_date,
      created_at,
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

  const loans = data || [];

  const activeLoans = loans.filter(
    (loan) =>
      String(loan.loan_status).toLowerCase() ===
      "active"
  );

  const completedLoans = loans.filter(
    (loan) =>
      String(loan.loan_status).toLowerCase() ===
      "completed"
  );

  const totalPrincipal = loans.reduce(
    (sum, loan) =>
      sum + toNumber(
        loan.principal_amount
      ),
    0
  );

  const totalBalance = activeLoans.reduce(
    (sum, loan) =>
      sum + toNumber(
        loan.current_balance
      ),
    0
  );

  const totalPaid = loans.reduce(
    (sum, loan) =>
      sum + toNumber(
        loan.total_paid
      ),
    0
  );

  const totalInterest = loans.reduce(
    (sum, loan) =>
      sum + toNumber(
        loan.interest_amount
      ),
    0
  );

  return {
    loans,
    activeLoans,
    completedLoans,

    totalLoans: loans.length,

    activeLoanCount:
      activeLoans.length,

    completedLoanCount:
      completedLoans.length,

    totalPrincipal,

    totalBalance,

    totalPaid,

    totalInterest,
  };
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

  const { data, error } = await supabase
    .from("loan_transactions")
    .select("*")
    .order("transaction_date", {
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
   GET LOAN TRANSACTIONS WITH LOAN NUMBER
========================================================= */

export async function getRecentLoanTransactions(
  limit = 20
) {
  const safeLimit = Math.max(
    Number(limit) || 20,
    1
  );

  const { data, error } = await supabase
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
   GET LOANS DUE FOR INTEREST
========================================================= */

export async function getLoansDueForInterest() {
  const now =
    new Date().toISOString();

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
    .gt("current_balance", 0)
    .not("next_interest_date", "is", null)
    .lte("next_interest_date", now)
    .order("next_interest_date", {
      ascending: true,
    });

  if (error) {
    console.error(
      "GET DUE LOANS ERROR:",
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
  const safeLimit = Math.max(
    Number(limit) || 20,
    1
  );

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
    .gt("current_balance", 0)
    .not("next_interest_date", "is", null)
    .order("next_interest_date", {
      ascending: true,
    })
    .limit(safeLimit);

  if (error) {
    console.error(
      "GET UPCOMING INTEREST ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load upcoming interest dates."
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

  const { data, error } = await supabase
    .from("loans")
    .select("*")
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
   REALTIME LOAN SUBSCRIPTION
========================================================= */

export function subscribeToLoans(
  callback
) {
  const channel = supabase
    .channel("loan-service-loans")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "loans",
      },
      (payload) => {
        if (typeof callback === "function") {
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
  const channel = supabase
    .channel("loan-service-transactions")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "loan_transactions",
      },
      (payload) => {
        if (typeof callback === "function") {
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
    throw new Error(
      "Loan ID is required."
    );
  }

  const loanChannel = supabase
    .channel(
      `loan-service-loan-${loanId}`
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
        if (typeof callback === "function") {
          callback({
            type: "loan",
            payload,
          });
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
        if (typeof callback === "function") {
          callback({
            type: "transaction",
            payload,
          });
        }
      }
    )
    .subscribe();

  return loanChannel;
}


/* =========================================================
   REMOVE REALTIME CHANNEL
========================================================= */

export async function removeLoanSubscription(
  channel
) {
  if (!channel) return;

  await supabase.removeChannel(
    channel
  );
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
