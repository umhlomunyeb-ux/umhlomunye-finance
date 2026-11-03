import { getInterestRateForAmount } from "../services/settingsService";

/**
 * Get the maximum permitted term for a loan amount
 * using ONLY the rules stored in Settings.
 *
 * Example configured rules:
 *
 * term_1_max_amount = 5000
 * term_1_months     = 1
 *
 * term_2_max_amount = 8000
 * term_2_months     = 3
 *
 * term_3_months     = 6
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

  const term1Max = Number(settings.term_1_max_amount);
  const term1Months = Number(settings.term_1_months);

  const term2Max = Number(settings.term_2_max_amount);
  const term2Months = Number(settings.term_2_months);

  const term3Months = Number(settings.term_3_months);

  const configuredMaximumTerm = Number(
    settings.maximum_loan_term_months
  );

  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    !Number.isFinite(term1Max) ||
    !Number.isFinite(term1Months) ||
    !Number.isFinite(term2Max) ||
    !Number.isFinite(term2Months) ||
    !Number.isFinite(term3Months)
  ) {
    throw new Error(
      "Loan term settings are incomplete or invalid."
    );
  }

  if (principal < minimum) {
    throw new Error(
      `The minimum loan amount is R${minimum.toLocaleString(
        "en-ZA",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }
      )}.`
    );
  }

  if (principal > maximum) {
    throw new Error(
      `The maximum loan amount is R${maximum.toLocaleString(
        "en-ZA",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }
      )}.`
    );
  }

  let termMonths;

  if (principal <= term1Max) {
    termMonths = term1Months;
  } else if (principal <= term2Max) {
    termMonths = term2Months;
  } else {
    termMonths = term3Months;
  }

  /*
   * The global maximum term remains a final safety limit.
   */
  if (
    Number.isFinite(configuredMaximumTerm) &&
    configuredMaximumTerm > 0 &&
    termMonths > configuredMaximumTerm
  ) {
    throw new Error(
      `The calculated loan term of ${termMonths} months exceeds the maximum configured term of ${configuredMaximumTerm} months.`
    );
  }

  return termMonths;
}


/**
 * Calculate a new loan using the current system rules.
 *
 * Interest rate comes from Settings.
 * Loan term comes from Settings.
 */
export function calculateLoan(amount, settings) {
  const principal = Number(amount);

  const empty = {
    principalAmount: Number.isFinite(principal) ? principal : 0,
    interestRate: 0,
    interestAmount: 0,
    totalRepayment: 0,
    monthlyRepayment: 0,
    balance: 0,
    termMonths: 0,
    initialBalance: 0,
    additionalInterestRate: 40,
    additionalInterestDateDays: 8,
  };

  if (!settings) throw new Error("Loan settings could not be loaded.");
  if (!Number.isFinite(principal) || principal <= 0) return empty;

  const minimum = Number(settings.minimum_loan_amount);
  const maximum = Number(settings.maximum_loan_amount);
  if (principal < minimum || principal > maximum) return empty;

  const interestRate = Number(getInterestRateForAmount(principal, settings));
  const termMonths = getLoanTermForAmount(principal, settings);
  if (!Number.isFinite(interestRate) || interestRate < 0) {
    throw new Error("The configured interest rate is invalid.");
  }

  // Charge the initial 40% once when the loan is issued.
  const interestAmount = Number((principal * interestRate / 100).toFixed(2));
  const initialBalance = Number((principal + interestAmount).toFixed(2));

  let monthlyRepayment;
  let totalRepayment;

  if (termMonths === 2) {
    // The second 40% charge is applied to the balance remaining after
    // instalment one. Solve for two equal instalments:
    // X = (initialBalance - X) * 1.40.
    monthlyRepayment = Number((initialBalance * 1.4 / 2.4).toFixed(2));
    totalRepayment = Number((monthlyRepayment * 2).toFixed(2));
  } else {
    monthlyRepayment = initialBalance;
    totalRepayment = initialBalance;
  }

  return {
    principalAmount: principal,
    interestRate,
    interestAmount,
    totalRepayment,
    monthlyRepayment,
    balance: initialBalance,
    initialBalance,
    additionalInterestRate: interestRate,
    additionalInterestDateDays: Number(settings.interest_cycle_days) || 8,
    termMonths,
  };
}
