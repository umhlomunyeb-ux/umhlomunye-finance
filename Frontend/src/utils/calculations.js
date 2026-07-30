export function calculateInterest(balance) {
  return balance <= 2000
    ? balance * 0.40
    : balance * 0.30;
}

export function calculateNewBalance(balance, payment) {
  return Number(balance) - Number(payment);
}