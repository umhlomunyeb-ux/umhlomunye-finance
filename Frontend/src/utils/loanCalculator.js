export function calculateLoan(amount) {

    const principal = Number(amount);

    const rate =
        principal <= 2000 ? 40 : 30;

    const interest =
        principal * (rate / 100);

    const total =
        principal + interest;

    return {

        principal,

        interestRate: rate,

        interestAmount: interest,

        totalRepayment: total,

        currentBalance: total

    };

}