import { supabase } from "../lib/supabase";
import { isCurrentUserAdmin } from "./userService";

const DOCUMENTS_BUCKET = "documents";

/* =========================================================
   DOCUMENT HELPERS
========================================================= */

function extractReturnedId(data, preferredKeys = []) {
  if (!data) return null;

  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const id = extractReturnedId(item, preferredKeys);

      if (id) {
        return id;
      }
    }

    return null;
  }

  if (typeof data === "object") {
    for (const key of [
      ...preferredKeys,
      "id",
      "borrowing_id",
      "debt_repayment_id",
      "repayment_id",
    ]) {
      if (data[key]) {
        return data[key];
      }
    }
  }

  return null;
}

async function registerCentralDocument({
  file,
  documentPath,
  documentType,
  documentCategory,
  borrowingId = null,
  debtRepaymentId = null,
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("documents")
    .insert({
      borrowing_id: borrowingId,
      debt_repayment_id: debtRepaymentId,
      document_type: documentType,
      document_category: documentCategory,
      document_name: file.name,
      document_path: documentPath,
      created_by: user?.id || null,
      mime_type: file.type || null,
      file_size_bytes: file.size || 0,
      source_type: "STAFF_UPLOAD",
      verification_status: "PENDING",
      is_archived: false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(
      getErrorMessage(
        error,
        "The document was uploaded but could not be registered in Documents."
      )
    );
  }

  return data;
}

/* =========================================================
   BANK SERVICE
========================================================= */

/*
  The bank ledger is the authoritative company cash ledger.

  IN:
    - Initial Balance
    - Money Added
    - Company Borrowing
    - Customer Loan Repayments
    - Other Income

  OUT:
    - Loan Disbursements
    - Company Debt Repayments
    - Bank Fees
    - Other Expenses

  Bank fees are recorded as ONE consolidated amount per
  statement period, not as individual bank-charge transactions.
*/


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
   BANK ACCOUNT
========================================================= */

export async function getBankAccount() {
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("is_active", true)
    .order("created_at", {
      ascending: true,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "GET BANK ACCOUNT ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load the bank account."
      )
    );
  }

  return data;
}


/* =========================================================
   BANK TRANSACTIONS
========================================================= */

export async function getBankTransactions() {
  const { data, error } = await supabase
    .from("bank_transactions")
    .select(`
      *,
      bank_accounts (
        account_name,
        bank_name
      )
    `)
    .order("transaction_date", {
      ascending: false,
    })
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error(
      "GET BANK TRANSACTIONS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load bank transactions."
      )
    );
  }

  return data || [];
}


/* =========================================================
   CURRENT BANK BALANCE
========================================================= */

export async function getBankBalance() {
  const transactions =
    await getBankTransactions();

  return transactions
    .filter(
      (transaction) =>
        transaction.is_void !== true
    )
    .reduce(
      (balance, transaction) => {
        const amount = toNumber(
          transaction.amount
        );

        return transaction.direction === "IN"
          ? balance + amount
          : balance - amount;
      },
      0
    );
}


/* =========================================================
   INITIAL COMPANY BALANCE
========================================================= */

export async function createInitialBankBalance({
  accountName = "Company Bank Account",
  bankName = "",
  amount,
  transactionDate,
  description = "Initial company bank balance",
}) {
  const numericAmount = toNumber(amount);

  if (numericAmount <= 0) {
    throw new Error(
      "Initial balance must be greater than zero."
    );
  }

  const { data, error } =
    await supabase.rpc(
      "create_initial_bank_balance",
      {
        p_account_name: accountName,
        p_bank_name: bankName || null,
        p_amount: numericAmount,
        p_transaction_date:
          transactionDate,
        p_description: description,
      }
    );

  if (error) {
    console.error(
      "CREATE INITIAL BANK BALANCE ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to create the initial bank balance."
      )
    );
  }

  return data;
}


/* =========================================================
   ADD MONEY
========================================================= */

export async function addBankMoney({
  amount,
  transactionDate,
  description,
  reference = "",
}) {
  const numericAmount = toNumber(amount);

  if (numericAmount <= 0) {
    throw new Error(
      "Amount must be greater than zero."
    );
  }

  const { data, error } =
    await supabase.rpc(
      "add_bank_money",
      {
        p_amount: numericAmount,
        p_transaction_date:
          transactionDate,
        p_description:
          description,
        p_reference:
          reference || null,
      }
    );

  if (error) {
    console.error(
      "ADD BANK MONEY ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to record the money received."
      )
    );
  }

  return data;
}


/* =========================================================
   COMPANY BORROWING
========================================================= */

export async function createCompanyBorrowing({
  lenderName,
  amount,
  borrowingDate,
  description = "",
  reference = "",
  borrowingAgreementFile = null,
}) {
  const numericAmount = toNumber(amount);

  if (!lenderName?.trim()) {
    throw new Error(
      "Lender name is required."
    );
  }

  if (numericAmount <= 0) {
    throw new Error(
      "Borrowing amount must be greater than zero."
    );
  }

  if (!borrowingAgreementFile) {
    throw new Error(
      "Borrowing agreement/evidence document is required."
    );
  }

  const extension =
    borrowingAgreementFile.name
      ?.split(".")
      .pop() || "file";

  const fileName =
    `${crypto.randomUUID()}.${extension}`;

  /*
    Central Documents storage.

    The document is stored under the borrowing
    folder and then registered in the documents table.
  */
  const borrowingAgreementPath =
    `borrowings/${fileName}`;

  const { error: uploadError } =
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(
        borrowingAgreementPath,
        borrowingAgreementFile,
        {
          upsert: false,
        }
      );

  if (uploadError) {
    throw new Error(
      getErrorMessage(
        uploadError,
        "Unable to upload the borrowing agreement."
      )
    );
  }

  /*
    Create the actual company borrowing.

    The existing RPC remains responsible for
    the accounting/ledger transaction.
  */
  const { data, error } =
    await supabase.rpc(
      "create_company_borrowing_with_agreement",
      {
        p_lender_name:
          lenderName.trim(),

        p_amount:
          numericAmount,

        p_borrowing_date:
          borrowingDate,

        p_description:
          description || null,

        p_reference:
          reference || null,

        p_borrowing_agreement_path:
          borrowingAgreementPath,
      }
    );

  if (error) {
    /*
      Remove uploaded document when the
      borrowing itself fails.
    */
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([
        borrowingAgreementPath,
      ]);

    console.error(
      "CREATE COMPANY BORROWING ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to record the company borrowing."
      )
    );
  }

  /*
    Determine the borrowing ID returned by
    the existing RPC.
  */
  const borrowingId =
    extractReturnedId(
      data,
      ["borrowing_id"]
    );

  if (!borrowingId) {
    /*
      The borrowing was created but there is
      no safe way to link the document to it.
    */
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([
        borrowingAgreementPath,
      ]);

    throw new Error(
      "Company borrowing was recorded, but its borrowing ID could not be determined for document filing."
    );
  }

  /*
    Register the SAME uploaded file in the
    existing central documents table.

    No second document upload is performed.
  */
  try {
    await registerCentralDocument({
      file:
        borrowingAgreementFile,

      documentPath:
        borrowingAgreementPath,

      documentType:
        "Borrowing Agreement",

      documentCategory:
        "BORROWING",

      borrowingId,
    });
  } catch (documentError) {
    console.error(
      "REGISTER BORROWING DOCUMENT ERROR:",
      documentError
    );

    throw new Error(
      documentError.message ||
        "Company borrowing was recorded, but the borrowing document could not be registered."
    );
  }

  return data;
}


/* =========================================================
   COMPANY DEBT REPAYMENT
========================================================= */

export async function repayCompanyDebt({
  borrowingId,
  amount,
  repaymentDate,
  description = "",
  proofOfPaymentFile = null,
}) {
  const numericAmount =
    toNumber(amount);

  if (!borrowingId) {
    throw new Error(
      "Company borrowing is required."
    );
  }

  if (numericAmount <= 0) {
    throw new Error(
      "Repayment amount must be greater than zero."
    );
  }

  if (!proofOfPaymentFile) {
    throw new Error(
      "Proof of payment is required."
    );
  }

  const extension =
    proofOfPaymentFile.name
      ?.split(".")
      .pop() || "file";

  const fileName =
    `${crypto.randomUUID()}.${extension}`;

  /*
    Central Documents storage.

    Keep the repayment evidence grouped
    under the relevant company borrowing.
  */
  const proofPath =
    `debt-repayments/${borrowingId}/${fileName}`;

  const { error: uploadError } =
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(
        proofPath,
        proofOfPaymentFile,
        {
          upsert: false,
        }
      );

  if (uploadError) {
    throw new Error(
      getErrorMessage(
        uploadError,
        "Unable to upload the proof of payment."
      )
    );
  }

  /*
    Existing RPC remains responsible for
    recording the actual debt repayment and
    bank transaction.
  */
  const { data, error } =
    await supabase.rpc(
      "record_company_debt_repayment",
      {
        p_borrowing_id:
          borrowingId,

        p_amount:
          numericAmount,

        p_repayment_date:
          repaymentDate,

        p_description:
          description || null,

        p_proof_of_payment_path:
          proofPath,
      }
    );

  if (error) {
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([
        proofPath,
      ]);

    console.error(
      "REPAY COMPANY DEBT ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to record the company debt repayment."
      )
    );
  }

  /*
    Determine the repayment ID returned
    by the existing RPC.
  */
  const debtRepaymentId =
    extractReturnedId(
      data,
      [
        "debt_repayment_id",
        "repayment_id",
      ]
    );

  if (!debtRepaymentId) {
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([
        proofPath,
      ]);

    throw new Error(
      "Debt repayment was recorded, but its repayment ID could not be determined for document filing."
    );
  }

  /*
    Register the SAME uploaded file in the
    central documents table.
  */
  try {
    await registerCentralDocument({
      file:
        proofOfPaymentFile,

      documentPath:
        proofPath,

      documentType:
        "Proof of Payment",

      documentCategory:
        "DEBT_REPAYMENT",

      borrowingId,

      debtRepaymentId,
    });
  } catch (documentError) {
    console.error(
      "REGISTER DEBT REPAYMENT DOCUMENT ERROR:",
      documentError
    );

    throw new Error(
      documentError.message ||
        "Debt repayment was recorded, but the proof of payment could not be registered."
    );
  }

  return data;
}


/* =========================================================
   BANK FEES
========================================================= */

/*
  IMPORTANT:

  Bank fees are consolidated.

  Example:

    September statement:
      EFT fees             R32.50
      Monthly account fee R149.00
      Other charges        R18.50

    The system records:

      BANK_FEES
      September Bank Fees
      R200.00

  It does NOT create three separate transactions.
*/

export async function createBankFees({
  statementPeriod,
  feeDate,
  amount,
  description = "",
  reference = "",
}) {
  if (!statementPeriod) {
    throw new Error(
      "Statement period is required."
    );
  }

  if (!feeDate) {
    throw new Error(
      "Fee date is required."
    );
  }

  const numericAmount =
    toNumber(amount);

  if (numericAmount <= 0) {
    throw new Error(
      "Bank fees must be greater than zero."
    );
  }

  /*
    Check for an existing consolidated Bank Fees
    transaction for the same statement period.

    We use the reference field to identify the period.
  */
  const periodReference =
    `BANK-FEES-${statementPeriod}`;

  const {
    data: existing,
    error: existingError,
  } = await supabase
    .from("bank_transactions")
    .select(
      "id, amount, transaction_date, description"
    )
    .eq(
      "transaction_type",
      "BANK_FEES"
    )
    .eq(
      "reference",
      periodReference
    )
    .eq(
      "is_void",
      false
    )
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error(
      "CHECK BANK FEES ERROR:",
      existingError
    );

    throw new Error(
      getErrorMessage(
        existingError,
        "Unable to check existing bank fees."
      )
    );
  }

  if (existing) {
    throw new Error(
      `Bank fees for ${statementPeriod} have already been recorded.`
    );
  }

  const finalDescription =
    description?.trim() ||
    `${statementPeriod} Bank Fees`;

  const {
    data: bankAccount,
    error: accountError,
  } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("is_active", true)
    .order("created_at", {
      ascending: true,
    })
    .limit(1)
    .maybeSingle();

  if (accountError) {
    console.error(
      "GET BANK ACCOUNT FOR FEES ERROR:",
      accountError
    );

    throw new Error(
      getErrorMessage(
        accountError,
        "Unable to load the active bank account."
      )
    );
  }

  if (!bankAccount?.id) {
    throw new Error(
      "No active company bank account was found."
    );
  }

  const {
    data: {
      user,
    },
  } = await supabase.auth.getUser();

  const {
    data,
    error,
  } = await supabase
    .from("bank_transactions")
    .insert([
      {
        bank_account_id:
          bankAccount.id,

        transaction_type:
          "BANK_FEES",

        direction:
          "OUT",

        amount:
          numericAmount,

        transaction_date:
          feeDate,

        description:
          finalDescription,

        reference:
          periodReference,

        created_by:
          user?.id || null,

        is_void:
          false,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error(
      "CREATE BANK FEES ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to record the bank fees."
      )
    );
  }

  return data;
}


/* =========================================================
   CHECK BANK FEES PERIOD
========================================================= */

export async function getBankFeesForPeriod(
  statementPeriod
) {
  if (!statementPeriod) {
    return null;
  }

  const periodReference =
    `BANK-FEES-${statementPeriod}`;

  const {
    data,
    error,
  } = await supabase
    .from("bank_transactions")
    .select("*")
    .eq(
      "transaction_type",
      "BANK_FEES"
    )
    .eq(
      "reference",
      periodReference
    )
    .eq(
      "is_void",
      false
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "GET BANK FEES ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to check bank fees."
      )
    );
  }

  return data;
}


/* =========================================================
   COMPANY BORROWINGS
========================================================= */

export async function getCompanyBorrowings() {
  const {
    data,
    error,
  } = await supabase
    .from("company_borrowings")
    .select("*")
    .order("borrowing_date", {
      ascending: false,
    });

  if (error) {
    console.error(
      "GET COMPANY BORROWINGS ERROR:",
      error
    );

    throw new Error(
      getErrorMessage(
        error,
        "Unable to load company borrowings."
      )
    );
  }

  const borrowings =
    data || [];

  if (!borrowings.length) {
    return [];
  }

  const admin =
    await isCurrentUserAdmin();

  if (!admin) {
    return borrowings.map(
      (borrowing) => ({
        ...borrowing,
        repayment_count: 0,
        last_repayment_number: 0,
      })
    );
  }

  const {
    data: repayments,
    error: repaymentError,
  } = await supabase
    .from("company_debt_repayments")
    .select(
      "id, borrowing_id"
    )
    .in(
      "borrowing_id",
      borrowings.map(
        (borrowing) =>
          borrowing.id
      )
    );

  if (repaymentError) {
    console.error(
      "GET COMPANY DEBT REPAYMENTS ERROR:",
      repaymentError
    );

    throw new Error(
      getErrorMessage(
        repaymentError,
        "Unable to load company debt repayments."
      )
    );
  }

  return borrowings.map(
    (borrowing) => {
      const borrowingRepayments =
        (repayments || []).filter(
          (repayment) =>
            repayment.borrowing_id ===
            borrowing.id
        );

      return {
        ...borrowing,

        repayment_count:
          borrowingRepayments.length,

        last_repayment_number:
          borrowingRepayments.length,
      };
    }
  );
}


/* =========================================================
   BANK SUMMARY
========================================================= */

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

  const activeTransactions =
    transactions.filter(
      (transaction) =>
        transaction.is_void !== true
    );

  const totalMoneyIn =
    activeTransactions
      .filter(
        (transaction) =>
          transaction.direction ===
          "IN"
      )
      .reduce(
        (total, transaction) =>
          total +
          toNumber(
            transaction.amount
          ),
        0
      );

  const totalMoneyOut =
    activeTransactions
      .filter(
        (transaction) =>
          transaction.direction ===
          "OUT"
      )
      .reduce(
        (total, transaction) =>
          total +
          toNumber(
            transaction.amount
          ),
        0
      );

  const totalBankFees =
    activeTransactions
      .filter(
        (transaction) =>
          transaction.transaction_type ===
          "BANK_FEES"
      )
      .reduce(
        (total, transaction) =>
          total +
          toNumber(
            transaction.amount
          ),
        0
      );

  const outstandingDebt =
    borrowings
      .filter(
        (borrowing) =>
          borrowing.status !==
          "Voided"
      )
      .reduce(
        (total, borrowing) =>
          total +
          toNumber(
            borrowing.outstanding_amount
          ),
        0
      );

  return {
    account,

    transactions,

    borrowings,

    totalMoneyIn,

    totalMoneyOut,

    totalBankFees,

    currentBalance:
      totalMoneyIn -
      totalMoneyOut,

    netMovement:
      totalMoneyIn -
      totalMoneyOut,

    outstandingDebt,
  };
}


/* =========================================================
   MONTHLY BANK REPORT
========================================================= */

export function getMonthlyBankReport(
  transactions,
  year,
  month
) {
  const safeTransactions =
    Array.isArray(
      transactions
    )
      ? transactions
      : [];

  const filtered =
    safeTransactions.filter(
      (transaction) => {
        if (
          transaction.is_void ===
          true
        ) {
          return false;
        }

        const date =
          new Date(
            transaction.transaction_date
          );

        return (
          date.getFullYear() ===
            Number(year) &&
          date.getMonth() ===
            Number(month)
        );
      }
    );

  return buildBankReport(
    filtered
  );
}


/* =========================================================
   YEARLY BANK REPORT
========================================================= */

export function getYearlyBankReport(
  transactions,
  year
) {
  const safeTransactions =
    Array.isArray(
      transactions
    )
      ? transactions
      : [];

  const filtered =
    safeTransactions.filter(
      (transaction) => {
        if (
          transaction.is_void ===
          true
        ) {
          return false;
        }

        const date =
          new Date(
            transaction.transaction_date
          );

        return (
          date.getFullYear() ===
          Number(year)
        );
      }
    );

  return buildBankReport(
    filtered
  );
}


/* =========================================================
   BUILD BANK REPORT
========================================================= */

function buildBankReport(
  transactions
) {
  const report = {
    moneyIn: 0,
    moneyOut: 0,

    loanDisbursements: 0,
    loanRepayments: 0,

    companyBorrowings: 0,
    companyDebtRepayments: 0,

    bankFees: 0,

    otherIncome: 0,
    otherExpenses: 0,
  };

  transactions.forEach(
    (transaction) => {
      const amount =
        toNumber(
          transaction.amount
        );

      const type =
        String(
          transaction.transaction_type ||
            ""
        ).toUpperCase();

      if (
        transaction.direction ===
        "IN"
      ) {
        report.moneyIn +=
          amount;
      }

      if (
        transaction.direction ===
        "OUT"
      ) {
        report.moneyOut +=
          amount;
      }

      if (
        type ===
          "LOAN_DISBURSEMENT" ||
        type === "LOAN"
      ) {
        report.loanDisbursements +=
          amount;
      }

      if (
        type ===
          "LOAN_REPAYMENT" ||
        type ===
          "REPAYMENT"
      ) {
        report.loanRepayments +=
          amount;
      }

      if (
        type ===
        "BORROWING"
      ) {
        report.companyBorrowings +=
          amount;
      }

      if (
        type ===
        "DEBT_REPAYMENT"
      ) {
        report.companyDebtRepayments +=
          amount;
      }

      if (
        type ===
        "BANK_FEES"
      ) {
        report.bankFees +=
          amount;
      }

      if (
        type ===
          "OTHER_INCOME" ||
        type ===
          "DEPOSIT"
      ) {
        report.otherIncome +=
          amount;
      }

      if (
        type ===
        "OTHER_EXPENSE"
      ) {
        report.otherExpenses +=
          amount;
      }
    }
  );

  report.netMovement =
    report.moneyIn -
    report.moneyOut;

  return report;
}


/* =========================================================
   REALTIME
========================================================= */

export function subscribeToBankTransactions(
  callback
) {
  return supabase
    .channel(
      `bank-transactions-realtime-${Date.now()}`
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table:
          "bank_transactions",
      },
      (payload) => {
        if (
          typeof callback ===
          "function"
        ) {
          callback(payload);
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table:
          "company_borrowings",
      },
      (payload) => {
        if (
          typeof callback ===
          "function"
        ) {
          callback(payload);
        }
      }
    )
    .subscribe();
}


/* =========================================================
   REMOVE REALTIME CHANNEL
========================================================= */

export async function removeBankSubscription(
  channel
) {
  if (!channel) {
    return;
  }

  await supabase.removeChannel(
    channel
  );
}


/* =========================================================
   DEFAULT EXPORT
========================================================= */

const bankService = {
  getBankAccount,
  getBankBalance,
  getBankTransactions,

  createInitialBankBalance,
  addBankMoney,

  createCompanyBorrowing,
  repayCompanyDebt,
  getCompanyBorrowings,

  createBankFees,
  getBankFeesForPeriod,

  getBankSummary,

  getMonthlyBankReport,
  getYearlyBankReport,

  subscribeToBankTransactions,
  removeBankSubscription,
};

export default bankService;