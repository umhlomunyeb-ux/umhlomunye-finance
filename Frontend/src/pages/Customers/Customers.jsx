import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from "@mui/material";

import CustomerToolbar from "../../components/customers/CustomerToolbar";
import CustomerTable from "../../components/customers/CustomerTable";
import CustomerForm from "./CustomerForm";
import { getCustomers } from "../../services/customerService";
import { supabase } from "../../lib/supabase";

const money = (value) => new Intl.NumberFormat("en-ZA", {
  style: "currency", currency: "ZAR", minimumFractionDigits: 2,
}).format(Number(value || 0));

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [open, setOpen] = useState(false);
  const [creditRequests, setCreditRequests] = useState([]);
  const [creditRequestsError, setCreditRequestsError] = useState("");
  const [reviewingRequestId, setReviewingRequestId] = useState("");

  useEffect(() => { loadCustomers(); }, [status]);
  useEffect(() => { loadCreditLimitRequests(); }, []);

  async function loadCustomers() {
    try {
      const data = await getCustomers(status);
      setCustomers(data || []);
      setFilteredCustomers(data || []);
    } catch (error) {
      console.error("Failed to load customers:", error);
    }
  }

  async function loadCreditLimitRequests() {
    setCreditRequestsError("");
    const { data, error } = await supabase
      .from("credit_limit_increase_requests")
      .select("id,current_credit_limit,requested_credit_limit,reason,payslip_storage_path,created_at,customers(customer_number,first_name,last_name,email,cellphone)")
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });
    if (error) {
      setCreditRequestsError(error.message || "Unable to load credit-limit requests.");
      setCreditRequests([]);
      return;
    }
    setCreditRequests(data || []);
  }

  useEffect(() => {
    const searchTerm = search.trim().toLowerCase();
    if (!searchTerm) { setFilteredCustomers(customers); return; }
    setFilteredCustomers(customers.filter((customer) =>
      customer.customer_number?.toLowerCase().includes(searchTerm) ||
      customer.first_name?.toLowerCase().includes(searchTerm) ||
      customer.last_name?.toLowerCase().includes(searchTerm) ||
      customer.cellphone?.toLowerCase().includes(searchTerm)
    ));
  }, [search, customers]);

  async function viewPayslip(path) {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 300);
    if (error) { window.alert(error.message || "Unable to open the payslip."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function reviewCreditLimitRequest(request, approved) {
    const customer = request.customers || {};
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
    const decision = approved
      ? `Approve the increase for ${customerName} to ${money(request.requested_credit_limit)}?`
      : `Reject the credit-limit increase request from ${customerName}?`;
    if (!window.confirm(decision)) return;
    const notes = window.prompt("Optional administrator notes:", "") ?? "";
    setReviewingRequestId(request.id);
    try {
      const { data, error } = await supabase.rpc("review_credit_limit_increase_request", {
        p_request_id: request.id,
        p_approved: approved,
        p_admin_notes: notes,
      });
      if (error) throw error;
      if (!data?.success) throw new Error("The request could not be reviewed.");
      await loadCreditLimitRequests();
      window.alert(approved ? "Credit limit updated and request approved." : "Request rejected.");
    } catch (error) {
      window.alert(error.message || "Unable to review this request.");
    } finally {
      setReviewingRequestId("");
    }
  }

  return (
    <>
      <CustomerToolbar
        onAdd={() => setOpen(true)}
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
      />

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
          <Box>
            <Typography variant="h6" fontWeight="bold">Credit-Limit Increase Requests</Typography>
            <Typography variant="body2" color="text.secondary">Customer requests requiring administrator approval. Review the latest payslip before deciding.</Typography>
          </Box>
          <Button variant="outlined" onClick={loadCreditLimitRequests}>Refresh</Button>
        </Box>
        {creditRequestsError && <Alert severity="warning" sx={{ mb: 2 }}>{creditRequestsError}</Alert>}
        {!creditRequestsError && creditRequests.length === 0 && <Alert severity="info">There are no pending credit-limit increase requests.</Alert>}
        {creditRequests.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell>Customer</TableCell><TableCell>Current Limit</TableCell><TableCell>Requested Limit</TableCell>
                <TableCell>Reason</TableCell><TableCell>Submitted</TableCell><TableCell>Payslip</TableCell><TableCell>Decision</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {creditRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>{[request.customers?.first_name, request.customers?.last_name].filter(Boolean).join(" ")}<br /><Typography variant="caption" color="text.secondary">{request.customers?.customer_number || ""}</Typography></TableCell>
                    <TableCell>{money(request.current_credit_limit)}</TableCell>
                    <TableCell>{money(request.requested_credit_limit)}</TableCell>
                    <TableCell sx={{ minWidth: 180, whiteSpace: "normal" }}>{request.reason}</TableCell>
                    <TableCell>{new Date(request.created_at).toLocaleDateString("en-ZA")}</TableCell>
                    <TableCell><Button size="small" onClick={() => viewPayslip(request.payslip_storage_path)}>View Payslip</Button></TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        <Button size="small" variant="contained" color="success" disabled={reviewingRequestId === request.id} onClick={() => reviewCreditLimitRequest(request, true)}>Approve</Button>
                        <Button size="small" variant="outlined" color="error" disabled={reviewingRequestId === request.id} onClick={() => reviewCreditLimitRequest(request, false)}>Reject</Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <CustomerTable customers={filteredCustomers} onChanged={loadCustomers} />
      <CustomerForm open={open} onClose={() => setOpen(false)} onSaved={loadCustomers} />
    </>
  );
}
