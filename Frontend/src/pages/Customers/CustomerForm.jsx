import { useEffect, useState } from "react";

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  TextField,
} from "@mui/material";

import {
  addCustomer,
  generateCustomerNumber,
  customerExists,
} from "../../services/customerService";

import { parseSouthAfricanId } from "../../utils/saIdValidator";

import toast from "react-hot-toast";

export default function CustomerForm({ open, onClose, onSaved }) {
  const [customer, setCustomer] = useState({
    customer_number: "",
    first_name: "",
    last_name: "",
    id_number: "",
    date_of_birth: "",
    gender: "",
    cellphone: "",
    email: "",
    physical_address: "",
    occupation: "",
    employer: "",
    monthly_income: "",
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
  if (open) {
    loadCustomerNumber();
  }
}, [open]);

async function loadCustomerNumber() {
  const customerNumber = await generateCustomerNumber();

  setCustomer((prev) => ({
    ...prev,
    customer_number: customerNumber,
  }));
}

  function handleChange(e) {
    const { name, value } = e.target;

    let updatedCustomer = {
      ...customer,
      [name]: value,
    };

    if (name === "id_number") {

      if (value.length === 13) {

        const result = parseSouthAfricanId(value);

        if (result.valid) {

          updatedCustomer.date_of_birth = result.birthDate;
          updatedCustomer.gender = result.gender;

        } else {

          alert(result.message);

          updatedCustomer.date_of_birth = "";
          updatedCustomer.gender = "";

        }

      }

    } 

    setCustomer(updatedCustomer);
  }

  async function handleSave() {
    try {
      setSaving(true);
      if (!customer.first_name.trim()) {
        toast.error("First name is required.");
        return;
      }

      if (!customer.last_name.trim()) {
        toast.error("Last name is required.");
        return;
      }

      if (!customer.id_number.trim()) {
        toast.error("ID number is required.");
        return;
      }

      if (!customer.cellphone.trim()) {
        toast.error("Cellphone is required.");
        return;
      }

      const exists = await customerExists(customer.id_number);

      if (exists) {
        toast.error("Customer already exists.");
        return;
      }

      const customerToSave = {
        ...customer,
        date_of_birth: customer.date_of_birth || null,
        gender: customer.gender || null,
        email: customer.email || null,
        physical_address: customer.physical_address || null,
        occupation: customer.occupation || null,
        employer: customer.employer || null,
        monthly_income:
          customer.monthly_income === ""
            ? null
            : Number(customer.monthly_income),
      };

      await addCustomer(customerToSave);

      toast.success("Customer saved successfully.");

      await onSaved();

      setCustomer({
        customer_number: "",
        first_name: "",
        last_name: "",
        id_number: "",
        date_of_birth: "",
        gender: "",
        cellphone: "",
        email: "",
        physical_address: "",
        occupation: "",
        employer: "",
        monthly_income: "",
      });

      onClose();

    } catch (err) {
      console.error("Error saving customer:", err);
      toast.error(err.message || "Failed to save customer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} maxWidth="md" fullWidth>
      <DialogTitle>New Customer</DialogTitle>

      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Customer Number"
              name="customer_number"
              value={customer.customer_number}
              InputProps={{
              readOnly: true,
              }}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="First Name"
              name="first_name"
              value={customer.first_name}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Last Name"
              name="last_name"
              value={customer.last_name}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="ID Number"
              name="id_number"
              value={customer.id_number}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Date of Birth"
              name="date_of_birth"
              value={customer.date_of_birth}
              InputProps={{
                readOnly: true,
              }}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Gender"
              name="gender"
              value={customer.gender}
              InputProps={{
                readOnly: true,
              }}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Cellphone"
              name="cellphone"
              value={customer.cellphone}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Email"
              name="email"
              value={customer.email}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Physical Address"
              name="physical_address"
              value={customer.physical_address}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Employer"
              name="employer"
              value={customer.employer}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              label="Occupation"
              name="occupation"
              value={customer.occupation}
              onChange={handleChange}
            />
          </Grid>

          <Grid item xs={6}>
            <TextField
              fullWidth
              type="number"
              label="Monthly Income"
              name="monthly_income"
              value={customer.monthly_income}
              onChange={handleChange}
            />
          </Grid>

        </Grid>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>

        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Customer"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}