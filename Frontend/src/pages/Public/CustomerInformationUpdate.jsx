import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Grid,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { supabase } from "../../lib/supabase";

const EMPTY = {
  cellphone: "",
  alternative_phone: "",
  email: "",
  physical_address: "",
  postal_address: "",
  occupation: "",
  employer: "",
  monthly_income: "",
};

export default function CustomerInformationUpdate() {
  const { token } = useParams();
  const [form, setForm] = useState(EMPTY);
  const [customerNumber, setCustomerNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        const { data, error: rpcError } = await supabase.rpc(
          "get_customer_information_update",
          { p_token: token }
        );
        if (rpcError) throw rpcError;
        if (!active) return;
        const customer = data || {};
        setCustomerNumber(customer.customer_number || "");
        setCustomerName([customer.first_name, customer.last_name].filter(Boolean).join(" "));
        setForm({
          cellphone: customer.cellphone || "",
          alternative_phone: customer.alternative_phone || "",
          email: customer.email || "",
          physical_address: customer.physical_address || "",
          postal_address: customer.postal_address || "",
          occupation: customer.occupation || "",
          employer: customer.employer || "",
          monthly_income: customer.monthly_income ?? "",
        });
      } catch (err) {
        if (active) setError(err.message || "This update link is invalid or has expired.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [token]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!confirmed) {
      setError("Please confirm that the information supplied is accurate.");
      return;
    }
    if (!form.cellphone.trim()) {
      setError("A cellphone number is required.");
      return;
    }
    const income = form.monthly_income === "" ? null : Number(form.monthly_income);
    if (income !== null && (!Number.isFinite(income) || income < 0)) {
      setError("Please enter a valid monthly income.");
      return;
    }
    try {
      setSaving(true);
      const { data, error: rpcError } = await supabase.rpc(
        "submit_customer_information_update",
        {
          p_token: token,
          p_cellphone: form.cellphone.trim(),
          p_alternative_phone: form.alternative_phone || null,
          p_email: form.email || null,
          p_physical_address: form.physical_address || null,
          p_postal_address: form.postal_address || null,
          p_occupation: form.occupation || null,
          p_employer: form.employer || null,
          p_monthly_income: income,
        }
      );
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.message || "Unable to save your information.");
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Your information could not be updated. Please contact Umhlomunye Finance.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Container maxWidth="sm" sx={{ py: 6, textAlign: "center" }}><CircularProgress /><Typography sx={{ mt: 2 }}>Loading your secure update form...</Typography></Container>;
  }

  if (success) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography color="success.main" sx={{ fontSize: 56, lineHeight: 1 }}>✓</Typography>
          <Typography variant="h5" sx={{ mt: 2 }}>Information updated</Typography>
          <Typography sx={{ mt: 1 }}>Thank you, {customerName || "customer"}. Your details have been updated successfully.</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>Reference: {customerNumber}</Typography>
          <Alert severity="info" sx={{ mt: 3 }}>This was an information update only. No loan application has been submitted.</Alert>
        </Paper>
      </Container>
    );
  }

  if (error && !customerNumber) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h5">Customer information update</Typography>
          <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
          <Typography sx={{ mt: 2 }}>Please contact Umhlomunye Finance on 078 078 3879 or WhatsApp 060 508 6672 to request a new link.</Typography>
        </Paper>
      </Container>
    );
  }

  const field = (label, name, props = {}) => (
    <Grid item xs={12} sm={6}>
      <TextField fullWidth label={label} name={name} value={form[name]} onChange={handleChange} {...props} />
    </Grid>
  );

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper sx={{ p: { xs: 2, sm: 4 } }}>
        <Typography variant="h4">Update Your Information</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>Umhlomunye Finance · Customer {customerNumber}</Typography>
        <Alert severity="info" sx={{ mt: 2 }}>Use this secure page to update your existing customer details. This is not a loan application and will not submit a loan request.</Alert>
        <Typography sx={{ mt: 2 }}>Customer: <strong>{customerName}</strong></Typography>
        <Divider sx={{ my: 3 }} />
        <Box component="form" onSubmit={handleSubmit}>
          <Typography variant="h6" sx={{ mb: 2 }}>Contact information</Typography>
          <Grid container spacing={2}>
            {field("Cellphone number *", "cellphone", { required: true })}
            {field("Alternative phone", "alternative_phone")}
            {field("Email address", "email", { type: "email" })}
            {field("Physical address", "physical_address", { multiline: true, minRows: 2 })}
            {field("Postal address", "postal_address", { multiline: true, minRows: 2 })}
          </Grid>
          <Typography variant="h6" sx={{ mt: 3, mb: 2 }}>Employment and income</Typography>
          <Grid container spacing={2}>
            {field("Occupation", "occupation")}
            {field("Employer", "employer")}
            {field("Monthly income (R)", "monthly_income", { type: "number", inputProps: { min: 0, step: "0.01" } })}
          </Grid>
          <Alert severity="warning" sx={{ mt: 3 }}>For your protection, this link can be used once and expires after 7 days. If your cellphone number has changed and you cannot receive messages on your registered number, contact our office for assistance.</Alert>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
            <input id="confirm-information" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <label htmlFor="confirm-information">I confirm that the information above is correct and may be updated on my customer record.</label>
          </Box>
          <Button type="submit" fullWidth variant="contained" size="large" sx={{ mt: 3 }} disabled={saving || !confirmed}>
            {saving ? "Saving information..." : "Update My Information"}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 3 }}>Your information is handled in accordance with Umhlomunye Finance's privacy policy.</Typography>
      </Paper>
    </Container>
  );
}
