import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { supabase } from "../../lib/supabase";
import { recordInvestorFunding } from "../../services/investorFundingService";
import MobileBottomNavigation from "../components/MobileBottomNavigation";

const money = (value) => `R ${Number(value || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

export default function MobileFundingRequests() {
  const [requests, setRequests] = useState([]);
  const [investors, setInvestors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ investorId: "", amount: "", receivedDate: today(), bankReference: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [requestResult, investorResult] = await Promise.all([
        supabase.from("investor_funding_requests").select("*").eq("status", "REQUESTED").order("created_at", { ascending: true }),
        supabase.from("investors").select("id,investor_name,is_active").eq("is_active", true).order("investor_name"),
      ]);
      if (requestResult.error) throw requestResult.error;
      if (investorResult.error) throw investorResult.error;
      setRequests(requestResult.data || []);
      setInvestors(investorResult.data || []);
    } catch (err) { setError(err?.message || "Unable to load pending funding requests."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel("mobile-funding-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "investor_funding_requests" }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  function openRequest(request) {
    setSelected(request);
    setForm({ investorId: "", amount: String(request.funding_shortfall || ""), receivedDate: today(), bankReference: "" });
    setDialogOpen(true);
    setError(""); setSuccess("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected) return;
    if (!form.investorId || !form.bankReference.trim() || Number(form.amount) <= 0) {
      setError("Select an investor, enter the received amount and provide the bank reference.");
      return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      await recordInvestorFunding({ requestId: selected.id, ...form });
      setDialogOpen(false); setSelected(null);
      setSuccess("Funding receipt recorded. The request has been moved out of the pending list.");
      await load();
    } catch (err) { setError(err?.message || "Unable to update the funding request."); }
    finally { setSaving(false); }
  }

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "#f4f6f8", pb: 10 }}>
      <Box sx={{ position: "sticky", top: 0, zIndex: 20, bgcolor: "white", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flex: 1 }}>
            <Typography fontWeight={800} fontSize={20}>Funding Requests</Typography>
            <Typography variant="caption" color="text.secondary">{requests.length} pending request{requests.length === 1 ? "" : "s"}</Typography>
          </Box>
          <Button startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refresh</Button>
        </Stack>
      </Box>
      <Box sx={{ p: 1.5, maxWidth: 760, mx: "auto" }}>
        {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError("")}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setSuccess("")}>{success}</Alert>}
        {loading ? <Box sx={{ display: "grid", placeItems: "center", minHeight: "45vh" }}><CircularProgress /></Box>
          : requests.length === 0 ? <Card><CardContent><Typography fontWeight={700}>No pending funding requests</Typography><Typography color="text.secondary" variant="body2">Requests will appear here when an application needs investor funding.</Typography></CardContent></Card>
          : <Stack spacing={1.5}>
            {requests.map((request) => <Card key={request.id} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 3 }}>
              <CardContent>
                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={800}>{request.application_number || "Loan application"}</Typography>
                      <Typography color="text.secondary" variant="body2">{request.customer_name || "Applicant"}</Typography>
                    </Box>
                    <Chip size="small" color={request.alert_status === "SENT" ? "success" : "warning"} label={request.alert_status === "SENT" ? "Admin emailed" : "Awaiting funds"} />
                  </Stack>
                  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                    <Box><Typography variant="caption" color="text.secondary">Loan amount</Typography><Typography fontWeight={700}>{money(request.loan_amount)}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Funding required</Typography><Typography fontWeight={800} color="primary.main">{money(request.funding_shortfall)}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Bank balance at request</Typography><Typography>{money(request.available_bank_balance)}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Estimated investor interest</Typography><Typography>{money(request.estimated_interest)}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Estimated total liability</Typography><Typography>{money(request.estimated_total_liability)}</Typography></Box>
                    <Box><Typography variant="caption" color="text.secondary">Term</Typography><Typography>{request.term_months} month{Number(request.term_months) === 1 ? "" : "s"}</Typography></Box>
                  </Box>
                  <Button fullWidth variant="contained" size="large" sx={{ minHeight: 50 }} onClick={() => openRequest(request)}>Update / Record Funds</Button>
                </Stack>
              </CardContent>
            </Card>)}
          </Stack>}
      </Box>
      <MobileBottomNavigation />
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth fullScreen>
        <Box component="form" onSubmit={submit}>
          <DialogTitle>Approve & Update Funding Request</DialogTitle>
          <DialogContent>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
              Record the investor's actual transfer. This action updates the bank ledger, creates the investor borrowing record and marks the request as funded.
            </Typography>
            {selected && <Alert severity="info" sx={{ mb: 2 }}>Current requested shortfall: {money(selected.funding_shortfall)}. The system will verify the live bank shortfall before accepting the receipt.</Alert>}
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField select fullWidth label="Investor" value={form.investorId} onChange={(e) => setForm((old) => ({ ...old, investorId: e.target.value }))} required>
                {investors.map((investor) => <MenuItem key={investor.id} value={investor.id}>{investor.investor_name}</MenuItem>)}
              </TextField>
              <TextField fullWidth type="number" label="Amount received" value={form.amount} onChange={(e) => setForm((old) => ({ ...old, amount: e.target.value }))} inputProps={{ min: "0.01", step: "0.01" }} required />
              <TextField fullWidth type="date" label="Date received" value={form.receivedDate} onChange={(e) => setForm((old) => ({ ...old, receivedDate: e.target.value }))} InputLabelProps={{ shrink: true }} required />
              <TextField fullWidth label="Bank transfer reference" value={form.bankReference} onChange={(e) => setForm((old) => ({ ...old, bankReference: e.target.value }))} required />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button fullWidth variant="outlined" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button fullWidth variant="contained" type="submit" disabled={saving || !form.investorId || !form.bankReference.trim()}>{saving ? "Updating..." : "Confirm Funding Received"}</Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
