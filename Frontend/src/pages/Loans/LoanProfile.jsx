import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import LoanTransactions from "../../components/loans/LoanTransactions";
import {
  Box,
  Paper,
  Grid,
  Typography,
  Divider,
  Button,
  Chip,
  CircularProgress,
  Tabs,
  Tab,
  Stack,
} from "@mui/material";

import { getLoan } from "../../services/loanService";

export default function LoanProfile() {
  const { id } = useParams();

  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    loadLoan();
  }, [id]);

  async function loadLoan() {
    try {
      const data = await getLoan(id);
      setLoan(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!loan) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography>Loan not found.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>

      <Typography variant="h4" gutterBottom>
        Loan Profile
      </Typography>

      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={tab}
          onChange={(e, value) => setTab(value)}
          variant="scrollable"
        >
          <Tab label="Overview" />
          <Tab label="Transactions" />
          <Tab label="Documents" />
          <Tab label="Notes" />
          <Tab label="Audit Log" />
        </Tabs>
      </Paper>

      {/* ================= OVERVIEW ================= */}

      {tab === 0 && (
        <>

          <Grid container spacing={3}>

            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3, height: "100%" }}>

                <Typography variant="h6">
                  Customer Information
                </Typography>

                <Divider sx={{ my: 2 }} />

                <Typography><strong>Customer Number:</strong> {loan.customers?.customer_number}</Typography>

                <Typography><strong>Name:</strong> {loan.customers?.first_name} {loan.customers?.last_name}</Typography>

                <Typography><strong>ID Number:</strong> {loan.customers?.id_number}</Typography>

                <Typography><strong>Cellphone:</strong> {loan.customers?.cellphone}</Typography>

                <Typography><strong>Employer:</strong> {loan.customers?.employer}</Typography>

                <Typography><strong>Monthly Income:</strong> R{loan.customers?.monthly_income}</Typography>

              </Paper>
            </Grid>

            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 3, height: "100%" }}>

                <Typography variant="h6">
                  Loan Information
                </Typography>

                <Divider sx={{ my: 2 }} />

                <Typography><strong>Loan Number:</strong> {loan.loan_number}</Typography>

                <Typography><strong>Principal:</strong> R{loan.principal_amount}</Typography>

                <Typography><strong>Interest Rate:</strong> {loan.interest_rate}%</Typography>

                <Typography><strong>Current Balance:</strong> R{loan.current_balance}</Typography>

                <Typography><strong>Total Paid:</strong> R{loan.total_paid}</Typography>

                <Typography sx={{ mt: 2 }}>
                  <Chip
                    label={loan.loan_status}
                    color={
                      loan.loan_status === "Active"
                        ? "success"
                        : loan.loan_status === "Paid"
                        ? "primary"
                        : "default"
                    }
                  />
                </Typography>

                <Typography sx={{ mt: 2 }}>
                  <strong>First Payment Date:</strong> {loan.first_payment_date}
                </Typography>

                <Typography>
                  <strong>Next Interest Date:</strong> {loan.next_interest_date || "-"}
                </Typography>

              </Paper>
            </Grid>

          </Grid>

          <Paper sx={{ mt: 3, p: 3 }}>

            <Typography variant="h6" gutterBottom>
              Quick Actions
            </Typography>

            <Stack
              direction="row"
              spacing={2}
              flexWrap="wrap"
            >

              <Button variant="contained">
                Capture Payment
              </Button>

              <Button variant="outlined">
                Print Statement
              </Button>

              <Button variant="outlined">
                Print Agreement
              </Button>

              <Button
                variant="contained"
                color="warning"
              >
                Edit Loan
              </Button>

              <Button
                variant="contained"
                color="error"
              >
                Void Loan
              </Button>

            </Stack>

          </Paper>

        </>
      )}

      {/* ================= TRANSACTIONS ================= */}

      {tab === 1 && (
        <LoanTransactions loanId={loan.id} />
      )}

      {/* ================= DOCUMENTS ================= */}

      {tab === 2 && (

        <Paper sx={{ p: 3 }}>

          <Typography variant="h5">
            Documents
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Typography color="text.secondary">
            Loan agreement, ID copy and supporting documents will appear here.
          </Typography>

        </Paper>

      )}

      {/* ================= NOTES ================= */}

      {tab === 3 && (

        <Paper sx={{ p: 3 }}>

          <Typography variant="h5">
            Notes
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Typography color="text.secondary">
            Internal staff notes will appear here.
          </Typography>

        </Paper>

      )}

      {/* ================= AUDIT LOG ================= */}

      {tab === 4 && (

        <Paper sx={{ p: 3 }}>

          <Typography variant="h5">
            Audit Log
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Typography color="text.secondary">
            All loan activity will be recorded here.
          </Typography>

        </Paper>

      )}

    </Box>
  );
}