import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Typography,
  Chip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";

import {
  deactivateCustomer,
  reactivateCustomer,
  blacklistCustomer,
  unblacklistCustomer,
} from "../../services/customerService";

import toast from "react-hot-toast";

export default function CustomerTable({ customers, onChanged }) {
  const [blacklistTarget, setBlacklistTarget] = useState(null);
  const [blacklistReason, setBlacklistReason] = useState("");
  const [savingBlacklist, setSavingBlacklist] = useState(false);

  async function handleDeactivate(id) {
    const confirmed = window.confirm(
      "Are you sure you want to deactivate this customer?"
    );

    if (!confirmed) return;

    try {
      await deactivateCustomer(id);
      toast.success("Customer deactivated successfully.");
      if (onChanged) await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to deactivate customer.");
    }
  }

  async function handleReactivate(id) {
    try {
      await reactivateCustomer(id);
      toast.success("Customer reactivated successfully.");
      if (onChanged) await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to reactivate customer.");
    }
  }

  function openBlacklistDialog(customer) {
    setBlacklistTarget(customer);
    setBlacklistReason(customer.blacklist_reason || "");
  }

  function closeBlacklistDialog() {
    if (savingBlacklist) return;
    setBlacklistTarget(null);
    setBlacklistReason("");
  }

  async function handleBlacklist() {
    if (!blacklistTarget) return;

    setSavingBlacklist(true);
    try {
      await blacklistCustomer(blacklistTarget.id, blacklistReason);
      toast.success("Customer blacklisted. New loans are blocked.");
      setBlacklistTarget(null);
      setBlacklistReason("");
      if (onChanged) await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to blacklist customer.");
    } finally {
      setSavingBlacklist(false);
    }
  }

  async function handleUnblacklist(customer) {
    const confirmed = window.confirm(
      `Remove the blacklist from ${customer.first_name} ${customer.last_name}? This will allow new loan applications to proceed subject to normal checks.`
    );
    if (!confirmed) return;

    try {
      await unblacklistCustomer(customer.id);
      toast.success("Customer blacklist removed.");
      if (onChanged) await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to remove customer blacklist.");
    }
  }

  if (!customers || customers.length === 0) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography>No customers found.</Typography>
      </Paper>
    );
  }

  return (
    <>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Customer Number</TableCell>
              <TableCell>First Name</TableCell>
              <TableCell>Last Name</TableCell>
              <TableCell>ID Number</TableCell>
              <TableCell>Cellphone</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Blacklist</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>{customer.customer_number}</TableCell>
                <TableCell>{customer.first_name}</TableCell>
                <TableCell>{customer.last_name}</TableCell>
                <TableCell>{customer.id_number}</TableCell>
                <TableCell>{customer.cellphone}</TableCell>
                <TableCell>
                  <Chip
                    label={customer.is_active ? "Active" : "Inactive"}
                    color={customer.is_active ? "success" : "default"}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  {customer.is_blacklisted ? (
                    <Chip
                      label="BLACKLISTED"
                      color="error"
                      size="small"
                      title={customer.blacklist_reason || "No reason supplied"}
                    />
                  ) : (
                    <Chip label="Clear" color="success" variant="outlined" size="small" />
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    component={Link}
                    to={`/customers/${customer.id}`}
                    variant="outlined"
                    size="small"
                    sx={{ mr: 1, mb: 0.5 }}
                  >
                    View
                  </Button>

                  {customer.is_active ? (
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => handleDeactivate(customer.id)}
                      sx={{ mr: 1, mb: 0.5 }}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="outlined"
                      color="success"
                      size="small"
                      onClick={() => handleReactivate(customer.id)}
                      sx={{ mr: 1, mb: 0.5 }}
                    >
                      Reactivate
                    </Button>
                  )}

                  {customer.is_blacklisted ? (
                    <Button
                      variant="contained"
                      color="success"
                      size="small"
                      onClick={() => handleUnblacklist(customer)}
                      sx={{ mb: 0.5 }}
                    >
                      Remove Blacklist
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      color="error"
                      size="small"
                      onClick={() => openBlacklistDialog(customer)}
                      sx={{ mb: 0.5 }}
                    >
                      Blacklist
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={Boolean(blacklistTarget)} onClose={closeBlacklistDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ color: "error.main", fontWeight: 700 }}>
          Blacklist Customer
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            {blacklistTarget
              ? `Blacklist ${blacklistTarget.first_name} ${blacklistTarget.last_name}? This customer will be blocked from receiving new loans, including loans created by an administrator.`
              : ""}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Reason (optional)"
            value={blacklistReason}
            onChange={(event) => setBlacklistReason(event.target.value)}
            placeholder="Enter the reason for blacklisting this customer"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeBlacklistDialog} disabled={savingBlacklist}>
            Cancel
          </Button>
          <Button
            onClick={handleBlacklist}
            color="error"
            variant="contained"
            disabled={savingBlacklist}
          >
            {savingBlacklist ? "Saving..." : "Confirm Blacklist"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
