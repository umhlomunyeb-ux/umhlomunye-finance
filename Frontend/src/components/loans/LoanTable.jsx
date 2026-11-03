import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table, TableBody, TableCell, TableHead, TableRow, Paper, Button,
  Stack, Chip, CircularProgress, Typography, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Alert, Divider,
} from "@mui/material";

import { getLoans } from "../../services/loanService";
import RecordPayment from "../../pages/Repayments/RecordPayment";
import {
  requestLoanTopUp,
  getLoanTopUpRequests,
  approveLoanTopUp,
  rejectLoanTopUp,
  processLoanTopUpFundingQueue,
} from "../../services/loanTopUpService";

export default function LoanTable({ refreshKey, search = "" }) {
  const navigate = useNavigate();
  const [loans, setLoans] = useState([]);
  const [topUps, setTopUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { loadData(); }, [refreshKey]);

  async function loadData() {
    try {
      setLoading(true);
      const [loanRows, topUpRows] = await Promise.all([
        getLoans(),
        getLoanTopUpRequests(),
      ]);
      setLoans(loanRows || []);
      setTopUps(topUpRows || []);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Unable to load loans and top-up requests.");
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

  function openTopUp(loan) {
    setSelectedLoan(loan);
    setTopUpAmount("");
    setError("");
    setTopUpOpen(true);
  }

  async function submitTopUp() {
    const amount = Number(topUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid top-up amount.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      await requestLoanTopUp(selectedLoan.id, amount);
      setTopUpOpen(false);
      setMessage("Top-up request submitted. The loan ledger will only change after administrator approval.");
      await loadData();
    } catch (err) {
      setError(err?.message || "Unable to submit top-up request.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(request) {
    try {
      setBusy(true);
      setError("");
      const result = await approveLoanTopUp(request.id);
      setMessage(
        result?.funding_status === "WAITING_FOR_FUNDS"
          ? "Top-up approved and posted to the loan ledger. It is waiting for company funds before disbursement."
          : "Top-up approved and posted to the loan ledger. Disbursement is ready for processing."
      );
      await loadData();
    } catch (err) {
      setError(err?.message || "Unable to approve top-up.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(request) {
    const reason = window.prompt("Reason for rejecting this top-up (optional):") || "";
    try {
      setBusy(true);
      setError("");
      await rejectLoanTopUp(request.id, reason);
      setMessage("Top-up request rejected. The loan ledger was not changed.");
      await loadData();
    } catch (err) {
      setError(err?.message || "Unable to reject top-up.");
    } finally {
      setBusy(false);
    }
  }

  async function handleProcessQueue() {
    try {
      setBusy(true);
      setError("");
      const result = await processLoanTopUpFundingQueue();
      setMessage(`${result?.processed || 0} approved top-up(s) disbursed from available company funds.`);
      await loadData();
    } catch (err) {
      setError(err?.message || "Unable to process the top-up funding queue.");
    } finally {
      setBusy(false);
    }
  }

  const searchTerm = search.trim().toLowerCase();
  const filteredLoans = loans.filter((loan) => {
    if (!searchTerm) return true;
    const customer = loan.customers || {};
    const values = [
      loan.loan_number, customer.customer_number, customer.first_name,
      customer.last_name, `${customer.first_name || ""} ${customer.last_name || ""}`,
    ];
    return values.some((value) => String(value || "").toLowerCase().includes(searchTerm));
  });

  if (loading) return <CircularProgress />;

  const pendingApproval = topUps.filter((item) => item.status === "PENDING_APPROVAL");
  const fundingQueue = topUps.filter((item) => ["WAITING_FOR_FUNDS", "READY_FOR_DISBURSEMENT"].includes(item.status));

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage("")}>{message}</Alert>}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Table>
          <TableHead><TableRow>
            <TableCell>Loan No</TableCell><TableCell>Customer</TableCell>
            <TableCell align="right">Principal</TableCell><TableCell align="right">Interest %</TableCell>
            <TableCell align="right">Balance</TableCell><TableCell>Status</TableCell>
            <TableCell>First Payment</TableCell><TableCell align="center">Actions</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {filteredLoans.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center"><Typography sx={{ py: 3 }}>
                {searchTerm ? "No loans found matching your search." : "No loans found."}
              </Typography></TableCell></TableRow>
            ) : filteredLoans.map((loan) => (
              <TableRow key={loan.id}>
                <TableCell>{loan.loan_number}</TableCell>
                <TableCell>{loan.customers?.customer_number}<br />{loan.customers?.first_name} {loan.customers?.last_name}</TableCell>
                <TableCell align="right">R{Number(loan.principal_amount).toFixed(2)}</TableCell>
                <TableCell align="right">{loan.interest_rate}%</TableCell>
                <TableCell align="right">R{Number(loan.current_balance).toFixed(2)}</TableCell>
                <TableCell><Chip label={loan.loan_status} color={loan.loan_status === "Active" ? "success" : "default"} size="small" /></TableCell>
                <TableCell>{loan.first_payment_date || "—"}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button size="small" variant="outlined" onClick={() => navigate(`/loans/${loan.id}`)}>View</Button>
                    <Button size="small" variant="contained" onClick={() => handlePaymentClick(loan)}>Payment</Button>
                    <Button size="small" color="warning" onClick={() => setMessage("Loan editing is being completed separately; use Top Up for an increase to an existing loan.")}>Edit</Button>
                    <Button size="small" variant="outlined" onClick={() => openTopUp(loan)} disabled={loan.loan_status !== "Active"}>Top Up</Button>
                    <Button size="small" color="error" disabled>Void</Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">Top-up approval requests</Typography>
          <Chip label={pendingApproval.length + " awaiting approval"} color={pendingApproval.length ? "warning" : "default"} />
        </Stack>
        <Table size="small">
          <TableHead><TableRow><TableCell>Loan</TableCell><TableCell>Customer</TableCell><TableCell align="right">Amount</TableCell><TableCell>Requested</TableCell><TableCell>Status</TableCell><TableCell>Action</TableCell></TableRow></TableHead>
          <TableBody>
            {topUps.length === 0 ? <TableRow><TableCell colSpan={6} align="center">No top-up requests.</TableCell></TableRow> :
              topUps.map((item) => <TableRow key={item.id}>
                <TableCell>{item.loans?.loan_number || item.loan_id}</TableCell>
                <TableCell>{item.loans?.customers?.first_name} {item.loans?.customers?.last_name}</TableCell>
                <TableCell align="right">R{Number(item.requested_amount).toFixed(2)}</TableCell>
                <TableCell>{new Date(item.created_at).toLocaleString("en-ZA")}</TableCell>
                <TableCell><Chip size="small" label={item.status.replaceAll("_", " ")} /></TableCell>
                <TableCell>
                  {item.status === "PENDING_APPROVAL" ? <Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" disabled={busy} onClick={() => handleApprove(item)}>Approve</Button>
                    <Button size="small" color="error" disabled={busy} onClick={() => handleReject(item)}>Reject</Button>
                  </Stack> : "—"}
                </TableCell>
              </TableRow>)}
          </TableBody>
        </Table>
        {fundingQueue.length > 0 && <Divider sx={{ my: 2 }} />}
        {fundingQueue.length > 0 && <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body2">{fundingQueue.length} approved top-up(s) awaiting disbursement</Typography>
          <Button variant="outlined" disabled={busy} onClick={handleProcessQueue}>Process funding queue</Button>
        </Stack>}
      </Paper>

      <Dialog open={topUpOpen} onClose={() => !busy && setTopUpOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Request loan top-up</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {selectedLoan?.loan_number} — current balance R{Number(selectedLoan?.current_balance || 0).toFixed(2)}.
            The loan balance will not change until an administrator approves this request.
          </Typography>
          <TextField autoFocus fullWidth type="number" label="Top-up amount (R)" value={topUpAmount}
            onChange={(event) => setTopUpAmount(event.target.value)} inputProps={{ min: 1, step: "0.01" }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTopUpOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submitTopUp} variant="contained" disabled={busy}>Submit for approval</Button>
        </DialogActions>
      </Dialog>

      <RecordPayment open={paymentOpen} loan={selectedLoan} onClose={handlePaymentClose}
        onSaved={async () => { await loadData(); }} />
    </>
  );
}