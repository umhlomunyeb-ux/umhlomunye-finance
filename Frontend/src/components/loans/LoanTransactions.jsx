import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import { getLoanTransactions } from "../../services/transactionService";


function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}


function formatMoney(value) {
  return `R${toNumber(value).toFixed(2)}`;
}


function getTransactionAmount(transaction) {
  const debit = toNumber(transaction?.debit);
  const credit = toNumber(transaction?.credit);

  if (debit > 0) {
    return debit;
  }

  if (credit > 0) {
    return credit;
  }

  return 0;
}


function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}


export default function LoanTransactions({ loanId }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");


  useEffect(() => {
    let mounted = true;

    async function loadTransactions() {
      if (!loanId) {
        if (mounted) {
          setTransactions([]);
          setLoading(false);
          setError("Loan ID is missing.");
        }

        return;
      }

      try {
        setLoading(true);
        setError("");

        const data = await getLoanTransactions(loanId);

        if (mounted) {
          setTransactions(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error(
          "LOAD LOAN TRANSACTIONS ERROR:",
          err
        );

        if (mounted) {
          setError(
            err?.message ||
              "Unable to load loan transactions."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadTransactions();

    return () => {
      mounted = false;
    };
  }, [loanId]);


  if (loading) {
    return (
      <Paper
        sx={{
          p: 3,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 180,
        }}
      >
        <CircularProgress />
      </Paper>
    );
  }


  if (error) {
    return (
      <Alert severity="error">
        {error}
      </Alert>
    );
  }


  return (
    <Paper
      sx={{
        p: 3,
        width: "100%",
        overflowX: "auto",
      }}
    >
      <Typography
        variant="h6"
        fontWeight={800}
        gutterBottom
      >
        Loan Transactions
      </Typography>

      {transactions.length === 0 ? (
        <Alert severity="info">
          No transactions have been recorded
          for this loan yet.
        </Alert>
      ) : (
        <Table
          size="small"
          sx={{
            minWidth: 850,
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell>
                <strong>Date</strong>
              </TableCell>

              <TableCell>
                <strong>Type</strong>
              </TableCell>

              <TableCell>
                <strong>Description</strong>
              </TableCell>

              <TableCell align="right">
                <strong>Debit</strong>
              </TableCell>

              <TableCell align="right">
                <strong>Credit</strong>
              </TableCell>

              <TableCell align="right">
                <strong>Amount</strong>
              </TableCell>

              <TableCell align="right">
                <strong>Balance</strong>
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {transactions.map((trx) => {
              const debit = toNumber(trx.debit);
              const credit = toNumber(trx.credit);
              const amount =
                getTransactionAmount(trx);

              return (
                <TableRow
                  key={trx.id}
                  hover
                >
                  <TableCell>
                    {formatDate(
                      trx.transaction_date ||
                        trx.created_at
                    )}
                  </TableCell>

                  <TableCell>
                    {trx.transaction_type || "-"}
                  </TableCell>

                  <TableCell>
                    {trx.description || "-"}
                  </TableCell>

                  <TableCell
                    align="right"
                    sx={{
                      fontWeight:
                        debit > 0 ? 700 : 400,
                    }}
                  >
                    {debit > 0
                      ? formatMoney(debit)
                      : "-"}
                  </TableCell>

                  <TableCell
                    align="right"
                    sx={{
                      fontWeight:
                        credit > 0 ? 700 : 400,
                    }}
                  >
                    {credit > 0
                      ? formatMoney(credit)
                      : "-"}
                  </TableCell>

                  <TableCell
                    align="right"
                    sx={{
                      fontWeight: 800,
                    }}
                  >
                    {formatMoney(amount)}
                  </TableCell>

                  <TableCell
                    align="right"
                    sx={{
                      fontWeight: 800,
                    }}
                  >
                    {formatMoney(trx.balance)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}