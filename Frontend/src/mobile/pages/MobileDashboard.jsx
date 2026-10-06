import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Alert,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import SavingsOutlinedIcon from "@mui/icons-material/SavingsOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import ArrowForwardIosOutlinedIcon from "@mui/icons-material/ArrowForwardIosOutlined";

import { supabase } from "../../lib/supabase";
import { getCurrentUserProfile } from "../../services/userService";

const INSTALLATION_ID_STORAGE_KEY = "lms_companion_installation_id";

function money(value) {
  return "R" + Number(value || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function count(value) {
  return Number(value || 0).toLocaleString("en-ZA");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function StatCard({ title, value, subtitle, icon }) {
  return (
    <Card elevation={1} sx={{ borderRadius: 3, height: "100%", border: "1px solid", borderColor: "divider" }}>
      <CardContent sx={{ p: 1.75 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 44, height: 44, minWidth: 44, borderRadius: 2.5, bgcolor: "primary.main", color: "primary.contrastText", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">{title}</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: "20px", lineHeight: 1.15, mt: 0.25, wordBreak: "break-word" }}>{value}</Typography>
            <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function MobileDashboard() {
  const navigate = useNavigate();
  const [userName, setUserName] = useState("User");
  const [companyName, setCompanyName] = useState("");
  const [loans, setLoans] = useState([]);
  const [loanTransactions, setLoanTransactions] = useState([]);
  const [applications, setApplications] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankTransactions, setBankTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    try {
      if (silent) setRefreshing(true); else setLoading(true);
      setError("");

      let installationId = "";
      try { installationId = localStorage.getItem(INSTALLATION_ID_STORAGE_KEY) || ""; } catch {}

      const [profile, settingsResult, loansResult, loanTransactionsResult, applicationsResult, bankAccountsResult, bankTransactionsResult] = await Promise.all([
        getCurrentUserProfile().catch(() => null),
        installationId ? supabase.rpc("get_mobile_installation_settings", { p_installation_id: installationId }) : Promise.resolve({ data: null, error: null }),
        supabase.from("loans").select("id,loan_number,loan_status,principal_amount,interest_amount,total_paid,current_balance,monthly_repayment,next_payment_date,next_interest_date,created_at").eq("is_deleted", false).order("created_at", { ascending: false }),
        supabase.from("loan_transactions").select("id,loan_id,transaction_date,transaction_type,description,debit,credit,balance,reference_number,payment_method").order("transaction_date", { ascending: false }),
        supabase.from("loan_applications").select("id,application_number,first_name,last_name,amount_requested,status,created_at").in("status", ["PENDING", "UNDER_REVIEW"]).order("created_at", { ascending: false }),
        supabase.from("bank_accounts").select("id,account_name,bank_name,account_number_last4,opening_balance,is_active").eq("is_active", true).order("created_at", { ascending: false }),
        supabase.from("bank_transactions").select("id,bank_account_id,transaction_date,transaction_type,description,amount,direction,balance_after,reference,is_void,created_at").order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
      ]);

      if (loansResult.error) throw loansResult.error;
      if (loanTransactionsResult.error) throw loanTransactionsResult.error;
      if (applicationsResult.error) throw applicationsResult.error;

      setUserName(profile?.full_name?.trim() || profile?.username || "User");
      setCompanyName(settingsResult?.data?.short_name || settingsResult?.data?.company_name || "");
      setLoans(loansResult.data || []);
      setLoanTransactions(loanTransactionsResult.data || []);
      setApplications(applicationsResult.data || []);
      setBankAccounts(bankAccountsResult?.error ? [] : bankAccountsResult.data || []);
      setBankTransactions(bankTransactionsResult?.error ? [] : bankTransactionsResult.data || []);
    } catch (err) {
      console.error("MOBILE FINANCIAL DASHBOARD ERROR:", err);
      setError(err?.message || "Unable to load the mobile financial dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    const interval = setInterval(() => loadDashboard({ silent: true }), 30000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const activeLoans = useMemo(() => loans.filter(loan => String(loan.loan_status || "").toLowerCase() === "active"), [loans]);
  const totalPrincipal = useMemo(() => loans.reduce((sum, loan) => sum + Number(loan.principal_amount || 0), 0), [loans]);
  const portfolioBalance = useMemo(() => activeLoans.reduce((sum, loan) => sum + Number(loan.current_balance || 0), 0), [activeLoans]);
  const totalPaid = useMemo(() => loans.reduce((sum, loan) => sum + Number(loan.total_paid || 0), 0), [loans]);
  const contractedInterest = useMemo(() => loans.reduce((sum, loan) => sum + Number(loan.interest_amount || 0), 0), [loans]);
  const interestCollected = useMemo(() => loanTransactions.filter(t => String(t.transaction_type || "").toLowerCase() === "payment").reduce((sum, t) => sum + Number(t.interest_amount ?? t.interest_collected ?? 0), 0), [loanTransactions]);
  const todayCollections = useMemo(() => {
    const start = startOfToday().getTime();
    const end = endOfToday().getTime();
    return loanTransactions.filter(t => String(t.transaction_type || "").toLowerCase() === "payment" && new Date(t.transaction_date).getTime() >= start && new Date(t.transaction_date).getTime() <= end).reduce((sum, t) => sum + Number(t.credit ?? t.amount ?? 0), 0);
  }, [loanTransactions]);
  const pendingAmount = useMemo(() => applications.reduce((sum, a) => sum + Number(a.amount_requested || 0), 0), [applications]);
  const dueToday = useMemo(() => {
    const start = startOfToday().getTime(); const end = endOfToday().getTime();
    return activeLoans.filter(loan => { if (!loan.next_payment_date) return false; const value = new Date(loan.next_payment_date).getTime(); return value >= start && value <= end; });
  }, [activeLoans]);
  const dueTodayAmount = useMemo(() => dueToday.reduce((sum, loan) => sum + Number(loan.monthly_repayment || 0), 0), [dueToday]);
  const bankCash = useMemo(() => {
    const latest = new Map();
    for (const transaction of bankTransactions) {
      if (transaction.is_void === true || latest.has(transaction.bank_account_id)) continue;
      latest.set(transaction.bank_account_id, Number(transaction.balance_after || 0));
    }
    return bankAccounts.reduce((sum, account) => sum + (latest.has(account.id) ? latest.get(account.id) : Number(account.opening_balance || 0)), 0);
  }, [bankAccounts, bankTransactions]);
  const recentPayments = useMemo(() => loanTransactions.filter(t => String(t.transaction_type || "").toLowerCase() === "payment").slice(0, 5), [loanTransactions]);

  if (loading) return <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "#f5f6f8" }}><Stack alignItems="center" spacing={2}><CircularProgress /><Typography color="text.secondary">Loading financial dashboard...</Typography></Stack></Box>;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "#f5f6f8", pb: 9 }}>
      <Box sx={{ position: "sticky", top: 0, zIndex: 20, bgcolor: "white", borderBottom: "1px solid", borderColor: "divider", px: 2, py: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 800, fontSize: "19px" }}>{companyName ? companyName + " Dashboard" : "Financial Dashboard"}</Typography><Typography variant="caption" color="text.secondary">Welcome, {userName}</Typography></Box>
          <Button size="small" variant="outlined" startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshOutlinedIcon />} onClick={() => loadDashboard({ silent: true })} disabled={refreshing} sx={{ minWidth: 0, textTransform: "none" }}>Refresh</Button>
        </Stack>
      </Box>
      <Box sx={{ p: 1.5 }}>
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25, mb: 1.5 }}>
          <StatCard title="Active Loans" value={count(activeLoans.length)} subtitle="Current portfolio" icon={<AccountBalanceWalletOutlinedIcon />} />
          <StatCard title="Portfolio Balance" value={money(portfolioBalance)} subtitle="Outstanding" icon={<TrendingUpOutlinedIcon />} />
          <StatCard title="Principal Disbursed" value={money(totalPrincipal)} subtitle="Recorded loans" icon={<PaymentsOutlinedIcon />} />
          <StatCard title="Total Paid" value={money(totalPaid)} subtitle="Recorded repayments" icon={<ReceiptLongOutlinedIcon />} />
          <StatCard title="Contracted Interest" value={money(contractedInterest)} subtitle="Loan interest" icon={<TrendingUpOutlinedIcon />} />
          <StatCard title="Interest Collected" value={money(interestCollected)} subtitle="From repayments" icon={<SavingsOutlinedIcon />} />
          <StatCard title="Today’s Collections" value={money(todayCollections)} subtitle="Payments today" icon={<PaymentsOutlinedIcon />} />
          <StatCard title="Bank Cash" value={money(bankCash)} subtitle="Active accounts" icon={<AccountBalanceWalletOutlinedIcon />} />
        </Box>
        <Card elevation={1} sx={{ borderRadius: 3, mb: 1.5, border: "1px solid", borderColor: "divider" }}><CardContent sx={{ p: 2 }}><Stack direction="row" spacing={1.5} alignItems="center"><Box sx={{ flex: 1 }}><Typography variant="caption" color="text.secondary">LOAN REVIEW</Typography><Typography sx={{ fontWeight: 800, fontSize: "21px", mt: 0.25 }}>{count(applications.length)}</Typography><Typography variant="body2" color="text.secondary">Applications awaiting review • {money(pendingAmount)}</Typography></Box><Button variant="contained" endIcon={<ArrowForwardIosOutlinedIcon sx={{ fontSize: 14 }} />} onClick={() => navigate("/mobile/application-review")} sx={{ minHeight: 44, fontWeight: 700, textTransform: "none" }}>Review</Button></Stack></CardContent></Card>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25, mb: 1.5 }}>
          <Card elevation={1} sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider" }}><CardContent sx={{ p: 2 }}><ScheduleOutlinedIcon color="action" /><Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>DUE TODAY</Typography><Typography sx={{ fontWeight: 800, fontSize: "20px" }}>{count(dueToday.length)}</Typography><Typography variant="caption" color="text.secondary">{money(dueTodayAmount)}</Typography></CardContent></Card>
          <Card elevation={1} sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider" }}><CardContent sx={{ p: 2 }}><DescriptionOutlinedIcon color="action" /><Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>TOTAL LOANS</Typography><Typography sx={{ fontWeight: 800, fontSize: "20px" }}>{count(loans.length)}</Typography><Typography variant="caption" color="text.secondary">All recorded loans</Typography></CardContent></Card>
        </Box>
        <Card elevation={1} sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider" }}><CardContent sx={{ p: 2 }}><Typography sx={{ fontWeight: 800, fontSize: "17px" }}>Recent Repayments</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Latest payments recorded</Typography>{recentPayments.length === 0 ? <Typography color="text.secondary">No repayments recorded yet.</Typography> : <Stack spacing={1.25}>{recentPayments.map(t => <Box key={t.id}><Stack direction="row" spacing={1} alignItems="center"><Box sx={{ flex: 1, minWidth: 0 }}><Typography fontWeight={700}>{t.reference_number || t.description || "Payment"}</Typography><Typography variant="caption" color="text.secondary">{t.payment_method || "Loan repayment"} • {formatDateTime(t.transaction_date)}</Typography></Box><Typography fontWeight={800} sx={{ whiteSpace: "nowrap" }}>{money(t.credit ?? t.amount ?? 0)}</Typography></Stack><Divider sx={{ mt: 1.25 }} /></Box>)}</Stack>}</CardContent></Card>
      </Box>
      <Paper elevation={8} sx={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, borderTop: "1px solid", borderColor: "divider" }}><BottomNavigation value="dashboard" onChange={(_, value) => { if (value === "dashboard") navigate("/mobile/dashboard"); if (value === "review") navigate("/mobile/application-review"); }} showLabels sx={{ height: 58 }}><BottomNavigationAction label="Dashboard" value="dashboard" icon={<HomeOutlinedIcon />} /><BottomNavigationAction label="Loan Review" value="review" icon={<DescriptionOutlinedIcon />} /></BottomNavigation></Paper>
    </Box>
  );
}