import { getInterestRateForAmount } from "../services/settingsService";

/**
 * Calculate a new loan using the current system rules.
 *
 * The rate comes from Settings:
 *
 * R100 - R2,000  -> 40%
 * Above R2,000   -> 30%
 */
export function calculateLoan(amount, settings) {
  const principal = Number(amount);

  if (!Number.isFinite(principal) || principal <= 0) {
    return {
      principalAmount: 0,
      interestRate: 0,
      interestAmount: 0,
      totalRepayment: 0,
      balance: 0,
    };
  }

  const interestRate = getInterestRateForAmount(
    principal,
    settings
  );

  const interestAmount = Number(
    (principal * (interestRate / 100)).toFixed(2)
  );

  const totalRepayment = Number(
    (principal + interestAmount).toFixed(2)
  );

  return {
    principalAmount: principal,
    interestRate,
    interestAmount,
    totalRepayment,
    balance: totalRepayment,
  };
}