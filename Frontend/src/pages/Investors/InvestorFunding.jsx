import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, Grid, MenuItem,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from "@mui/material";
import {
  Add, AccountBalance, Payments, Refresh, TrendingUp, Schedule,
} from "@mui/icons-material";
import {
  createInvestor, getInvestorFundingOverview, recordInvestorFunding,
  recordInvestorRepayment, sendPendingInvestorFundingAlerts,
} from "../../services/investorFundingService";

const money = (value) => new Intl.NumberFormat("en-ZA", {
  style: "currency", currency: "ZAR", minimumFractionDigits: 2,
}).format(Number(value || 0));

const today = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const initialInvestor = { investorName: "", email: "", cellphone: "", notes: "" };
const initialFunding = { investorId: "", amount: "", receivedDate: today(), bankReference: "" };
const initialRepayment = { amount: "", repaymentDate: today(), reference: "", description: "" };

function Metric({ title, value, icon }) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography color="text.secondary" variant="body2">{title}</Typography>
          {icon}
        </Stack>
        <Typography variant="h5" fontWeight={700} sx={{ mt: 1 }}>{value}</Typography>
      </CardContent>
    </Card>
  );
}

export default function InvestorFunding() {
  const [data, setData] = useState({ investors: [], requests: [], borrowings: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [investorDialog, setInvestorDialog] = useState(false);
  const [fundingDialog, setFundingDialog] = useState(false);
  const [repaymentDialog, setRepaymentDialog] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedBorrowing, setSelectedBorrowing] = useState(null);
  const [investorForm, setInvestorForm] = useState(initialInvestor);
  const [fundingForm, setFundingForm] = useState(initialFunding);
  const [repaymentForm, setRepaymentForm] = useState(initialRepayment);

  const load = useCallback(async ({ sendAlerts = true } = {}) => {
    setLoading(true);
    setError("");
    try {
      const overview = await getInvestorFundingOverview();
      setData(overview);
      if (sendAlerts) {
        try {
          await sendPendingInvestorFundingAlerts(overview.requests);
        } catch (alertError) {
          console.error("Investor funding alert:", alertError);
        }
      }
    } catch (loadError) {
      setError(loadError.message || "Unable to load investor funding information.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const outstanding = useMemo(
    () => data.borrowings.filter((item) => Number(item.outstanding_amount || 0) > 0 && item.status !== "Voided"),
    [data.borrowings]
  );
  const totalOutstanding = outstanding.reduce((sum, item) => sum + Number(item.outstanding_amount || 0), 0);
  const totalInterest = data.borrowings.reduce((sum, item) => sum + Number(item.interest_charged_total || 0), 0);
  const awaiting = data.requests.filter((item) => item.status === "REQUESTED");

  const runSave = async (action, message) => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
      await load({ sendAlerts: false });
    } catch (saveError) {
      setError(saveError.message || "The operation could not be completed.");
    } finally {
      setSaving(false);
    }
  };

  const submitInvestor = (event) => {
    event.preventDefault();
    if (!investorForm.investorName.trim()) return setError("Enter the investor's name.");
    runSave(async () => {
      await createInvestor(investorForm);
      setInvestorForm(initialInvestor);
      setInvestorDialog(false);
    }, "Investor profile created.");
  };

  const openFunding = (request) => {
    setSelectedRequest(request);
    setFundingForm({ ...initialFunding, amount: String(request.funding_shortfall) });
    setFundingDialog(true);
  };

  const submitFunding = (event) => {
    event.preventDefault();
    if (!selectedRequest) return;
    if (!fundingForm.investorId) return setError("Select the investor who transferred the funds.");
    if (!fundingForm.bankReference.trim()) return setError("Enter the bank transfer reference.");
    runSave(async () => {
      await recordInvestorFunding({
        requestId: selectedRequest.id,
        ...fundingForm,
      });
      setFundingDialog(false);
      setSelectedRequest(null);
      setFundingForm(initialFunding);
    }, "Investor funding receipt recorded and added to the company bank ledger.");
  };

  const openRepayment = (borrowing) => {
    setSelectedBorrowing(borrowing);
    setRepaymentForm(initialRepayment);
    setRepaymentDialog(true);
  };

  const submitRepayment = (event) => {
    event.preventDefault();
    if (!selectedBorrowing) return;
    if (!repaymentForm.reference.trim()) return setError("Enter the bank payment reference.");
    if (Number(repaymentForm.amount) > Number(selectedBorrowing.outstanding_amount)) {
      return setError("Repayment cannot exceed the outstanding investor liability.");
    }
    runSave(async () => {
      await recordInvestorRepayment({
        borrowingId: selectedBorrowing.id,
        ...repaymentForm,
      });
      setRepaymentDialog(false);
      setSelectedBorrowing(null);
      setRepaymentForm(initialRepayment);
    }, "Investor repayment recorded and bank balance updated.");
  };

  if (loading && !data.investors.length && !data.requests.length && !data.borrowings.length) {
    return <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1500, mx: "auto" }}>
      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={800}>Investor Funding</Typography>
          <Typography color="text.secondary">Manage investor capital, funding requests and monthly liabilities.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<Refresh />} onClick={() => load()} disabled={loading}>Refresh</Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => setInvestorDialog(true)}>Add Investor</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess("")}>{success}</Alert>}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}><Metric title="Active Investors" value={data.investors.filter((i) => i.is_active).length} icon={<AccountBalance color="primary" />} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Metric title="Awaiting Investor Funds" value={awaiting.length} icon={<Schedule color="warning" />} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Metric title="Investor Liability Outstanding" value={money(totalOutstanding)} icon={<Payments color="primary" />} /></Grid>
        <Grid item xs={12} sm={6} md={3}><Metric title="Interest Charged to Date" value={money(totalInterest)} icon={<TrendingUp color="warning" />} /></Grid>
      </Grid>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>Funding Requests</Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
            These applications have qualified for funding but the verified company bank balance does not cover the full amount. The funding shortfall is requested from an investor.
          </Typography>
          {awaiting.length === 0 ? <Alert severity="success">There are no outstanding investor funding requests.</Alert> : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow>
                  <TableCell>Application / Customer</TableCell><TableCell align="right">Loan Amount</TableCell>
                  <TableCell align="right">Bank Balance</TableCell><TableCell align="right">Investor Funding Needed</TableCell>
                  <TableCell align="right">Estimated Investor Interest</TableCell><TableCell align="right">Estimated Total Liability</TableCell>
                  <TableCell>Status</TableCell><TableCell>Action</TableCell>
                </TableRow></TableHead>
                <TableBody>{awaiting.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell><Typography fontWeight={700}>{request.application_number}</Typography><Typography variant="caption" color="text.secondary">{request.customer_name}</Typography></TableCell>
                    <TableCell align="right">{money(request.loan_amount)}</TableCell>
                    <TableCell align="right">{money(request.available_bank_balance)}</TableCell>
                    <TableCell align="right"><Typography fontWeight={700}>{money(request.funding_shortfall)}</Typography></TableCell>
                    <TableCell align="right">{money(request.estimated_interest)}</TableCell>
                    <TableCell align="right">{money(request.estimated_total_liability)}</TableCell>
                    <TableCell><Chip size="small" color={request.alert_status === "SENT" ? "success" : "warning"} label={request.alert_status === "SENT" ? "Admin emailed" : "Awaiting investor"} /></TableCell>
                    <TableCell><Button size="small" variant="contained" onClick={() => openFunding(request)}>Record Funds</Button></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6" fontWeight={700}>Investor Borrowings and Repayments</Typography>
            <Chip label="25% per month" color="info" variant="outlined" />
          </Stack>
          {data.borrowings.length === 0 ? <Alert severity="info">No investor funding has been recorded yet.</Alert> : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow>
                  <TableCell>Investor</TableCell><TableCell>Application</TableCell><TableCell align="right">Original Funding</TableCell>
                  <TableCell align="right">Interest Added</TableCell><TableCell align="right">Repaid</TableCell>
                  <TableCell align="right">Outstanding Liability</TableCell><TableCell>Next Interest Date</TableCell><TableCell>Status</TableCell><TableCell>Action</TableCell>
                </TableRow></TableHead>
                <TableBody>{data.borrowings.map((borrowing) => (
                  <TableRow key={borrowing.id}>
                    <TableCell>{borrowing.investors?.investor_name || borrowing.lender_name}</TableCell>
                    <TableCell>{borrowing.loan_applications?.application_number || "General funding"}</TableCell>
                    <TableCell align="right">{money(borrowing.original_amount)}</TableCell>
                    <TableCell align="right">{money(borrowing.interest_charged_total)}</TableCell>
                    <TableCell align="right">{money(borrowing.amount_repaid)}</TableCell>
                    <TableCell align="right"><Typography fontWeight={700}>{money(borrowing.outstanding_amount)}</Typography></TableCell>
                    <TableCell>{borrowing.next_interest_charge_date || "—"}</TableCell>
                    <TableCell><Chip size="small" label={borrowing.status} color={borrowing.status === "Paid" ? "success" : "warning"} /></TableCell>
                    <TableCell>{Number(borrowing.outstanding_amount) > 0 && <Button size="small" variant="outlined" onClick={() => openRepayment(borrowing)}>Repay</Button>}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>Investor Register</Typography>
          {data.investors.length === 0 ? <Alert severity="info">Add an investor to the register before recording investor funding.</Alert> : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow><TableCell>Investor</TableCell><TableCell>Email</TableCell><TableCell>Cellphone</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
                <TableBody>{data.investors.map((investor) => (
                  <TableRow key={investor.id}>
                    <TableCell>{investor.investor_name}</TableCell><TableCell>{investor.email || "—"}</TableCell>
                    <TableCell>{investor.cellphone || "—"}</TableCell><TableCell><Chip size="small" label={investor.is_active ? "Active" : "Inactive"} color={investor.is_active ? "success" : "default"} /></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog open={investorDialog} onClose={() => setInvestorDialog(false)} fullWidth maxWidth="sm">
        <Box component="form" onSubmit={submitInvestor}>
          <DialogTitle>Add Investor</DialogTitle>
          <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Investor Name" value={investorForm.investorName} onChange={(e) => setInvestorForm({ ...investorForm, investorName: e.target.value })} required fullWidth />
            <TextField label="Email Address" type="email" value={investorForm.email} onChange={(e) => setInvestorForm({ ...investorForm, email: e.target.value })} fullWidth />
            <TextField label="Cellphone" value={investorForm.cellphone} onChange={(e) => setInvestorForm({ ...investorForm, cellphone: e.target.value })} fullWidth />
            <TextField label="Notes" value={investorForm.notes} onChange={(e) => setInvestorForm({ ...investorForm, notes: e.target.value })} multiline minRows={2} fullWidth />
          </Stack></DialogContent>
          <DialogActions><Button onClick={() => setInvestorDialog(false)}>Cancel</Button><Button type="submit" variant="contained" disabled={saving}>{saving ? "Saving…" : "Save Investor"}</Button></DialogActions>
        </Box>
      </Dialog>

      <Dialog open={fundingDialog} onClose={() => setFundingDialog(false)} fullWidth maxWidth="sm">
        <Box component="form" onSubmit={submitFunding}>
          <DialogTitle>Record Investor Funds Received</DialogTitle>
          <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
            {selectedRequest && <Alert severity="info">Funding shortfall for {selectedRequest.application_number}: <strong>{money(selectedRequest.funding_shortfall)}</strong>. Investor interest is 25% monthly, first added four days after the customer's first instalment due date.</Alert>}
            <TextField select label="Investor" value={fundingForm.investorId} onChange={(e) => setFundingForm({ ...fundingForm, investorId: e.target.value })} required fullWidth>
              {data.investors.filter((i) => i.is_active).map((investor) => <MenuItem key={investor.id} value={investor.id}>{investor.investor_name}</MenuItem>)}
            </TextField>
            <TextField label="Amount Received" type="number" value={fundingForm.amount} inputProps={{ min: 0.01, step: "0.01" }} onChange={(e) => setFundingForm({ ...fundingForm, amount: e.target.value })} required fullWidth />
            <TextField label="Date Received" type="date" value={fundingForm.receivedDate} onChange={(e) => setFundingForm({ ...fundingForm, receivedDate: e.target.value })} InputLabelProps={{ shrink: true }} required fullWidth />
            <TextField label="Bank Transfer Reference" value={fundingForm.bankReference} onChange={(e) => setFundingForm({ ...fundingForm, bankReference: e.target.value })} required fullWidth />
          </Stack></DialogContent>
          <DialogActions><Button onClick={() => setFundingDialog(false)}>Cancel</Button><Button type="submit" variant="contained" disabled={saving || !data.investors.some((i) => i.is_active)}>{saving ? "Saving…" : "Confirm Funds Received"}</Button></DialogActions>
        </Box>
      </Dialog>

      <Dialog open={repaymentDialog} onClose={() => setRepaymentDialog(false)} fullWidth maxWidth="sm">
        <Box component="form" onSubmit={submitRepayment}>
          <DialogTitle>Record Investor Repayment</DialogTitle>
          <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
            {selectedBorrowing && <Alert severity="info">Outstanding investor liability: <strong>{money(selectedBorrowing.outstanding_amount)}</strong></Alert>}
            <TextField label="Repayment Amount" type="number" value={repaymentForm.amount} inputProps={{ min: 0.01, max: selectedBorrowing?.outstanding_amount, step: "0.01" }} onChange={(e) => setRepaymentForm({ ...repaymentForm, amount: e.target.value })} required fullWidth />
            <TextField label="Repayment Date" type="date" value={repaymentForm.repaymentDate} onChange={(e) => setRepaymentForm({ ...repaymentForm, repaymentDate: e.target.value })} InputLabelProps={{ shrink: true }} required fullWidth />
            <TextField label="Bank Payment Reference" value={repaymentForm.reference} onChange={(e) => setRepaymentForm({ ...repaymentForm, reference: e.target.value })} required fullWidth />
            <TextField label="Description" value={repaymentForm.description} onChange={(e) => setRepaymentForm({ ...repaymentForm, description: e.target.value })} fullWidth />
          </Stack></DialogContent>
          <DialogActions><Button onClick={() => setRepaymentDialog(false)}>Cancel</Button><Button type="submit" variant="contained" disabled={saving}>{saving ? "Saving…" : "Record Repayment"}</Button></DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
