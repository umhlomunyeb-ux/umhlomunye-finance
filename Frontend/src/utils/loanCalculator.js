import { getInterestRateForAmount } from "../services/settingsService";

/**
 * Return the single permitted loan term.
 *
 * All loans are one-month loans. The selected payment date is
 * the date on which the full outstanding balance is expected.
 */
export function getLoanTermForAmount(amount, settings) {
  const principal = Number(amount);

  if (!settings) {
    throw new Error("Loan settings could not be loaded.");
  }

  if (!Number.isFinite(principal) || principal <= 0) {
    throw new Error("Enter a valid loan amount.");
  }

  const minimum = Number(settings.minimum_loan_amount);
  const maximum = Number(settings.maximum_loan_amount);
  const termMonths = Number(settings.maximum_loan_term_months);

  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    termMonths !== 1
  ) {
    throw new Error("Loan term must be exactly 1 month.");
  }

  if (principal < minimum) {
    throw new Error(
      "The minimum loan amount is R" + minimum + "."
    );
  }

  if (principal > maximum) {
    throw new Error(
      "The maximum loan amount is R" + maximum + "."
    );
  }

  return 1;
}

/**
 * Calculate a new loan using the current system rules.
 *
 * Interest is charged once when the loan is approved.
 * If the balance remains outstanding after the selected payment
 * date, the database interest engine compounds interest on the
 * outstanding balance according to the configured monthly cycle.
 *
 * monthlyRepayment is retained only as a legacy database field;
 * it is equal to the full amount due because there are no instalments.
 */
export function calculateLoan(amount, settings) {
  const principal = Number(amount);

  if (!settings) {
    throw new Error("Loan settings could not be loaded.");
  }

  if (!Number.isFinite(principal) || principal <= 0) {
    return {
      principalAmount: 0,
      interestRate: 0,
      interestAmount: 0,
      totalRepayment: 0,
      monthlyRepayment: 0,
      balance: 0,
      termMonths: 0,
    };
  }

  const minimum = Number(settings.minimum_loan_amount);
  const maximum = Number(settings.maximum_loan_amount);

  if (principal < minimum || principal > maximum) {
    return {
      principalAmount: principal,
      interestRate: 0,
      interestAmount: 0,
      totalRepayment: 0,
      monthlyRepayment: 0,
      balance: 0,
      termMonths: 0,
    };
  }

  const interestRate = Number(
    getInterestRateForAmount(principal, settings)
  );

  const termMonths = getLoanTermForAmount(
    principal,
    settings
  );

  const interestAmount = Number(
    (
      principal *
      (interestRate / 100)
    ).toFixed(2)
  );

  const totalRepayment = Number(
    (
      principal +
      interestAmount
    ).toFixed(2)
  );

  return {
    principalAmount: principal,
    interestRate,
    interestAmount,
    totalRepayment,
    // Legacy field: there are no instalments; the full balance is due.
    monthlyRepayment: totalRepayment,
    balance: totalRepayment,
    termMonths,
  };
}