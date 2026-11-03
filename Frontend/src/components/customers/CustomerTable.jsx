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
} from "@mui/material";

import {
  blacklistCustomer,
  deactivateCustomer,
  reactivateCustomer,
  unblacklistCustomer,
} from "../../services/customerService";

import toast from "react-hot-toast";

export default function CustomerTable({ customers, onChanged }) {
  async function handleBlacklist(customer) {
    const reason = window.prompt(
      `Enter the reason for blacklisting ${customer.first_name} ${customer.last_name}:`
    );

    if (reason === null) return;
    if (!reason.trim()) {
      toast.error("A blacklist reason is required.");
      return;
    }

    try {
      await blacklistCustomer(customer.id, reason);
      toast.success("Customer blacklisted successfully.");
      if (onChanged) await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to blacklist customer.");
    }
  }

  async function handleUnblacklist(customer) {
    const confirmed = window.confirm(
      `Remove ${customer.first_name} ${customer.last_name} from the blacklist?`
    );
    if (!confirmed) return;

    try {
      await unblacklistCustomer(customer.id);
      toast.success("Customer removed from blacklist.");
      if (onChanged) await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to update blacklist.");
    }
  }

  async function handleDelete(customer) {
    const confirmed = window.confirm(
      `Delete customer ${customer.first_name} ${customer.last_name}? Their loan and repayment history will be retained.`
    );
    if (!confirmed) return;

    try {
      await deactivateCustomer(customer.id);
      toast.success("Customer deleted successfully.");
      if (onChanged) await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to delete customer.");
    }
  }

  async function handleIncreaseCreditLimit(customer) {
    const currentLimit = Number(customer.credit_limit || 6000);
    const entered = window.prompt(
      `Enter the new total credit limit for ${customer.first_name} ${customer.last_name}. Current limit: R${currentLimit.toFixed(2)}`,
      String(currentLimit)
    );

    if (entered === null) return;
    const newLimit = Number(String(entered).replace(/,/g, "").trim());
    if (!Number.isFinite(newLimit) || newLimit <= currentLimit) {
      toast.error("The new credit limit must be greater than the current limit.");
      return;
    }

    try {
      await increaseCustomerCreditLimit(customer.id, newLimit);
      toast.success(`Credit limit increased to R${newLimit.toFixed(2)}. It is effective immediately.`);
      if (onChanged) await onChanged();
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to increase customer credit limit.");
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

  if (!customers || customers.length === 0) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography>No customers found.</Typography>
      </Paper>
    );
  }

  return (
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
                  label={customer.is_blacklisted ? "Blacklisted" : customer.is_active ? "Active" : "Inactive"}
                  color={customer.is_blacklisted ? "error" : customer.is_active ? "success" : "default"}
                  size="small"
                />
                {customer.is_blacklisted && customer.blacklist_reason && (
                  <Typography variant="caption" display="block" color="error">
                    {customer.blacklist_reason}
                  </Typography>
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
                <Button
                  variant="outlined"
                  color="primary"
                  size="small"
                  onClick={() => handleIncreaseCreditLimit(customer)}
                  sx={{ mr: 1, mb: 0.5 }}
                >
                  Increase Credit Limit
                </Button>
                {customer.is_blacklisted ? (
                  <Button
                    variant="outlined"
                    color="success"
                    size="small"
                    onClick={() => handleUnblacklist(customer)}
                    sx={{ mr: 1, mb: 0.5 }}
                  >
                    Remove Blacklist
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    color="warning"
                    size="small"
                    onClick={() => handleBlacklist(customer)}
                    sx={{ mr: 1, mb: 0.5 }}
                  >
                    Blacklist
                  </Button>
                )}
                {customer.is_active ? (
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={() => handleDelete(customer)}
                    sx={{ mb: 0.5 }}
                  >
                    Delete Customer
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outlined"
                      color="success"
                      size="small"
                      onClick={() => handleReactivate(customer.id)}
                      sx={{ mr: 1, mb: 0.5 }}
                    >
                      Reactivate
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => handleDelete(customer)}
                      sx={{ mb: 0.5 }}
                    >
                      Delete Customer
                    </Button>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
