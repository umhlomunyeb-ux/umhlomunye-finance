import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
  Button,
  Stack,
  Chip,
  CircularProgress,
  Typography,
} from "@mui/material";

import { getLoans } from "../../services/loanService";
import RecordPayment from "../../pages/Repayments/RecordPayment";

export default function LoanTable({ refreshKey, search = "" }) {
  const navigate = useNavigate();

  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  // Payment dialog state
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);

  useEffect(() => {
    loadLoans();
  }, [refreshKey]);

  async function loadLoans() {
    try {
      setLoading(true);

      const data = await getLoans();

      setLoans(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handlePaymentClick(loan) {
    setSelectedLoan(loan);
    setPaymentOpen(true);
  }

  function handlePaymentClose() {
    setPaymentOpen(false);
    setSelectedLoan(null);
  }

  async function handlePaymentSaved() {
    await loadLoans();
  }

  /*
   * Search by:
   * - Loan number
   * - Customer number
   * - Customer first name
   * - Customer last name
   * - Full customer name
   */
  const searchTerm = search.trim().toLowerCase();

  const filteredLoans = loans.filter((loan) => {
    if (!searchTerm) {
      return true;
    }

    const loanNumber = String(loan.loan_number || "").toLowerCase();

    const customerNumber = String(
      loan.customers?.customer_number || ""
    ).toLowerCase();

    const firstName = String(
      loan.customers?.first_name || ""
    ).toLowerCase();

    const lastName = String(
      loan.customers?.last_name || ""
    ).toLowerCase();

    const fullName = `${firstName} ${lastName}`.trim();

    return (
      loanNumber.includes(searchTerm) ||
      customerNumber.includes(searchTerm) ||
      firstName.includes(searchTerm) ||
      lastName.includes(searchTerm) ||
      fullName.includes(searchTerm)
    );
  });

  if (loading) {
    return <CircularProgress />;
  }

  return (
    <>
      <Paper sx={{ p: 2 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Loan No</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell align="right">Principal</TableCell>
              <TableCell align="right">Interest %</TableCell>
              <TableCell align="right">Balance</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>First Payment</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {filteredLoans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography sx={{ py: 3 }}>
                    {searchTerm
                      ? "No loans found matching your search."
                      : "No loans found."}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredLoans.map((loan) => (
                <TableRow key={loan.id}>
                  <TableCell>
                    {loan.loan_number}
                  </TableCell>

                  <TableCell>
                    {loan.customers?.customer_number}
                    <br />
                    {loan.customers?.first_name}{" "}
                    {loan.customers?.last_name}
                  </TableCell>

                  <TableCell align="right">
                    R{Number(loan.principal_amount).toFixed(2)}
                  </TableCell>

                  <TableCell align="right">
                    {loan.interest_rate}%
                  </TableCell>

                  <TableCell align="right">
                    R{Number(loan.current_balance).toFixed(2)}
                  </TableCell>

                  <TableCell>
                    <Chip
                      label={loan.loan_status}
                      color={
                        loan.loan_status === "Active"
                          ? "success"
                          : "default"
                      }
                      size="small"
                    />
                  </TableCell>

                  <TableCell>
                    {loan.first_payment_date}
                  </TableCell>

                  <TableCell>
                    <Stack
                      direction="row"
                      spacing={1}
                    >
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() =>
                          navigate(`/loans/${loan.id}`)
                        }
                      >
                        View
                      </Button>

                      <Button
                        size="small"
                        variant="contained"
                        onClick={() =>
                          handlePaymentClick(loan)
                        }
                      >
                        Payment
                      </Button>

                      <Button
                        size="small"
                        color="warning"
                      >
                        Edit
                      </Button>

                      <Button
                        size="small"
                        color="error"
                      >
                        Void
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <RecordPayment
        open={paymentOpen}
        loan={selectedLoan}
        onClose={handlePaymentClose}
        onSaved={handlePaymentSaved}
      />
    </>
  );
}