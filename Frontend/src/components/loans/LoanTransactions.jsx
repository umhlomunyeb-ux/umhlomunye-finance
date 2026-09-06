import { useEffect, useState } from "react";
import {
  Paper,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
} from "@mui/material";

import { getLoanTransactions } from "../../services/transactionService";

export default function LoanTransactions({ loanId }) {

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTransactions();
  }, [loanId]);

  async function loadTransactions() {
    try {
      const data = await getLoanTransactions(loanId);
      setTransactions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <CircularProgress />;
  }

  return (
    <Paper sx={{ p: 3 }}>

      <Typography variant="h6" gutterBottom>
        Loan Transactions
      </Typography>

      <Table>

        <TableHead>

          <TableRow>

            <TableCell>Date</TableCell>

            <TableCell>Type</TableCell>

            <TableCell>Description</TableCell>

            <TableCell align="right">Debit</TableCell>

            <TableCell align="right">Credit</TableCell>

            <TableCell align="right">Balance</TableCell>

          </TableRow>

        </TableHead>

        <TableBody>

          {transactions.length === 0 && (

            <TableRow>

              <TableCell colSpan={6} align="center">
                No transactions found.
              </TableCell>

            </TableRow>

          )}

          {transactions.map((trx) => (

            <TableRow key={trx.id}>

              <TableCell>
                {trx.transaction_date
                  ? new Date(trx.transaction_date).toLocaleDateString("en-ZA")
                  : "-"}
              </TableCell>

              <TableCell>{trx.transaction_type}</TableCell>

              <TableCell>{trx.description}</TableCell>

              <TableCell align="right">
                {trx.debit ? `R${Number(trx.debit).toFixed(2)}` : "-"}
              </TableCell>

              <TableCell align="right">
                {trx.credit ? `R${Number(trx.credit).toFixed(2)}` : "-"}
              </TableCell>

              <TableCell align="right">
                R{Number(trx.balance).toFixed(2)}
              </TableCell>

            </TableRow>

          ))}

        </TableBody>

      </Table>

    </Paper>
  );
}