import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

import {
  Box,
  Paper,
  Typography,
  Divider,
  CircularProgress,
  Button,
  Grid,
  TextField,
  Chip,
} from "@mui/material";

import toast from "react-hot-toast";

import {
  updateCustomer,
  getCustomerById,
} from "../../services/customerService";

import { verifyExistingCustomer } from "../../services/existingClientService";
import { isCurrentUserAdmin } from "../../services/userService";
import { parseSouthAfricanId } from "../../utils/saIdValidator";

export default function CustomerProfile() {
  const { id } = useParams();

  const [customer, setCustomer] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCustomer();
    checkAdmin();
  }, [id]);

  async function checkAdmin() {
    try {
      setIsAdmin(Boolean(await isCurrentUserAdmin()));
    } catch (err) {
      console.error("Unable to check administrator access:", err);
      setIsAdmin(false);
    }
  }

  async function loadCustomer() {
    try {
      setLoading(true);
      setError("");

      const data = await getCustomerById(id);
      setCustomer(data);
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to load customer.");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e) {
    const { name, value } = e.target;
    let updatedCustomer = { ...customer, [name]: value };

    if (name === "id_number" && value.length === 13) {
      const result = parseSouthAfricanId(value);

      if (result.valid) {
        updatedCustomer.date_of_birth = result.birthDate;
        updatedCustomer.gender = result.gender;
      } else {
        toast.error(result.message);
        updatedCustomer.date_of_birth = "";
        updatedCustomer.gender = "";
      }
    }

    setCustomer(updatedCustomer);
  }

  async function handleSave() {
    try {
      setSaving(true);

      if (!customer.first_name?.trim()) {
        toast.error("First name is required.");
        return;
      }
      if (!customer.last_name?.trim()) {
        toast.error("Last name is required.");
        return;
      }
      if (!customer.id_number?.trim()) {
        toast.error("ID number is required.");
        return;
      }
      if (!customer.cellphone?.trim()) {
        toast.error("Cellphone is required.");
        return;
      }
      if (customer.id_number.length !== 13) {
        toast.error("ID number must contain exactly 13 digits.");
        return;
      }

      const updatedCustomer = {
        ...customer,
        date_of_birth: customer.date_of_birth || null,
        gender: customer.gender || null,
        email: customer.email || null,
        physical_address: customer.physical_address || null,
        alternative_phone: customer.alternative_phone || null,
        postal_address: customer.postal_address || null,
        occupation: customer.occupation || null,
        employer: customer.employer || null,
        monthly_income:
          customer.monthly_income === "" || customer.monthly_income === null
            ? null
            : Number(customer.monthly_income),
      };

      await updateCustomer(id, updatedCustomer);
      toast.success("Customer updated successfully.");
      setEditing(false);
      await loadCustomer();
    } catch (err) {
      console.error("Error updating customer:", err);
      toast.error(err.message || "Failed to update customer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleVerifyExistingClient() {
    const confirmed = window.confirm(
      "Confirm that this customer has previously borrowed from Umhlomunye Finance. Verification automatically removes the R1,500 first-loan restriction and grants eligibility up to R6,000."
    );

    if (!confirmed) return;

    try {
      setVerifying(true);
      await verifyExistingCustomer(customer.id);
      toast.success("Existing client verified. Loan limit eligibility is now R6,000.");
      await loadCustomer();
    } catch (err) {
      console.error("Existing-client verification failed:", err);
      toast.error(err.message || "Unable to verify existing client.");
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  if (!customer) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Customer not found.</Typography>
      </Box>
    );
  }

  const isVerifiedExistingClient = Boolean(customer.existing_client_verified_at);

  return (
    <Box sx={{ p: 3 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4">Customer Profile</Typography>
          <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
            {isVerifiedExistingClient ? (
              <Chip label="Verified Existing Client" color="success" />
            ) : (
              <Chip label="Standard Customer" variant="outlined" />
            )}
            {isVerifiedExistingClient && (
              <Chip label="Loan eligibility up to R6,000" color="primary" variant="outlined" />
            )}
          </Box>
        </Box>

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {!editing && (
            <Button variant="contained" onClick={() => setEditing(true)}>
              Edit Customer
            </Button>
          )}

          {editing && (
            <>
              <Button
                variant="outlined"
                onClick={() => {
                  setEditing(false);
                  loadCustomer();
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button variant="contained" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </>
          )}

          {isAdmin && !isVerifiedExistingClient && (
            <Button
              variant="contained"
              color="success"
              onClick={handleVerifyExistingClient}
              disabled={verifying || editing}
            >
              {verifying ? "Verifying..." : "Verify Existing Client"}
            </Button>
          )}

          <Button component={Link} to="/customers" variant="outlined">
            Back
          </Button>
        </Box>
      </Box>

      {isVerifiedExistingClient && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="body2">
            Verified on: {new Date(customer.existing_client_verified_at).toLocaleString("en-ZA")}
          </Typography>
          {customer.existing_client_verification_note && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Verification note: {customer.existing_client_verification_note}
            </Typography>
          )}
        </Paper>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">Personal Information</Typography>
            <Divider sx={{ my: 2 }} />

            <TextField
              fullWidth
              label="Customer Number"
              value={customer.customer_number || ""}
              InputProps={{ readOnly: true }}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="First Name"
              name="first_name"
              value={customer.first_name || ""}
              onChange={handleChange}
              disabled={!editing}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Last Name"
              name="last_name"
              value={customer.last_name || ""}
              onChange={handleChange}
              disabled={!editing}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="ID Number"
              name="id_number"
              value={customer.id_number || ""}
              onChange={handleChange}
              disabled={!editing}
              inputProps={{ maxLength: 13 }}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Date of Birth"
              value={customer.date_of_birth || ""}
              InputProps={{ readOnly: true }}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Gender"
              value={customer.gender || ""}
              InputProps={{ readOnly: true }}
            />
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">Contact Information</Typography>
            <Divider sx={{ my: 2 }} />

            <TextField
              fullWidth
              label="Cellphone"
              name="cellphone"
              value={customer.cellphone || ""}
              onChange={handleChange}
              disabled={!editing}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Alternative Phone"
              name="alternative_phone"
              value={customer.alternative_phone || ""}
              onChange={handleChange}
              disabled={!editing}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Email"
              name="email"
              value={customer.email || ""}
              onChange={handleChange}
              disabled={!editing}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Physical Address"
              name="physical_address"
              value={customer.physical_address || ""}
              onChange={handleChange}
              disabled={!editing}
              multiline
              rows={2}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Postal Address"
              name="postal_address"
              value={customer.postal_address || ""}
              onChange={handleChange}
              disabled={!editing}
            />
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">Employment & Income</Typography>
            <Divider sx={{ my: 2 }} />
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Occupation"
                  name="occupation"
                  value={customer.occupation || ""}
                  onChange={handleChange}
                  disabled={!editing}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Employer"
                  name="employer"
                  value={customer.employer || ""}
                  onChange={handleChange}
                  disabled={!editing}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  type="number"
                  label="Monthly Income"
                  name="monthly_income"
                  value={customer.monthly_income ?? ""}
                  onChange={handleChange}
                  disabled={!editing}
                />
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
