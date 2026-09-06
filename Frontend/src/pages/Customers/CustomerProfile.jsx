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
} from "@mui/material";

import toast from "react-hot-toast";

import {
  updateCustomer,
} from "../../services/customerService";

import { parseSouthAfricanId } from "../../utils/saIdValidator";

import { supabase } from "../../lib/supabase";

export default function CustomerProfile() {
  const { id } = useParams();

  const [customer, setCustomer] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCustomer();
  }, [id]);

  async function loadCustomer() {
    try {
      setLoading(true);
      setError("");

      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        throw error;
      }

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

    let updatedCustomer = {
      ...customer,
      [name]: value,
    };

    // Automatically regenerate DOB and gender
    // when the ID number changes.
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
          customer.monthly_income === "" ||
          customer.monthly_income === null
            ? null
            : Number(customer.monthly_income),
      };

      await updateCustomer(id, updatedCustomer);

      toast.success("Customer updated successfully.");

      setEditing(false);

      await loadCustomer();
    } catch (err) {
      console.error("Error updating customer:", err);

      toast.error(
        err.message || "Failed to update customer."
      );
    } finally {
      setSaving(false);
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
        <Typography color="error">
          {error}
        </Typography>
      </Box>
    );
  }

  if (!customer) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>
          Customer not found.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4">
          Customer Profile
        </Typography>

        <Box sx={{ display: "flex", gap: 1 }}>
          {!editing && (
            <Button
              variant="contained"
              onClick={() => setEditing(true)}
            >
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

              <Button
                variant="contained"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </>
          )}

          <Button
            component={Link}
            to="/customers"
            variant="outlined"
          >
            Back
          </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>

        {/* PERSONAL INFORMATION */}

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>

            <Typography variant="h6">
              Personal Information
            </Typography>

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

        {/* CONTACT INFORMATION */}

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>

            <Typography variant="h6">
              Contact Information
            </Typography>

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

        {/* EMPLOYMENT */}

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>

            <Typography variant="h6">
              Employment & Income
            </Typography>

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