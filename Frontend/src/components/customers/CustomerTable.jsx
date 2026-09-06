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
  deactivateCustomer,
  reactivateCustomer,
} from "../../services/customerService";

import toast from "react-hot-toast";

export default function CustomerTable({ customers, onChanged }) {

  async function handleDeactivate(id) {
    const confirmed = window.confirm(
      "Are you sure you want to deactivate this customer?"
    );

    if (!confirmed) return;

    try {
      await deactivateCustomer(id);

      toast.success("Customer deactivated successfully.");

      if (onChanged) {
        await onChanged();
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error.message || "Failed to deactivate customer."
      );
    }
  }

  async function handleReactivate(id) {
    try {
      await reactivateCustomer(id);

      toast.success("Customer reactivated successfully.");

      if (onChanged) {
        await onChanged();
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error.message || "Failed to reactivate customer."
      );
    }
  }

  if (!customers || customers.length === 0) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography>
          No customers found.
        </Typography>
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

              <TableCell>
                {customer.customer_number}
              </TableCell>

              <TableCell>
                {customer.first_name}
              </TableCell>

              <TableCell>
                {customer.last_name}
              </TableCell>

              <TableCell>
                {customer.id_number}
              </TableCell>

              <TableCell>
                {customer.cellphone}
              </TableCell>

              <TableCell>
                <Chip
                  label={
                    customer.is_active
                      ? "Active"
                      : "Inactive"
                  }
                  color={
                    customer.is_active
                      ? "success"
                      : "default"
                  }
                  size="small"
                />
              </TableCell>

              <TableCell>
                <Button
                  component={Link}
                  to={`/customers/${customer.id}`}
                  variant="outlined"
                  size="small"
                  sx={{ mr: 1 }}
                >
                  View
                </Button>

                {customer.is_active ? (
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={() =>
                      handleDeactivate(customer.id)
                    }
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    color="success"
                    size="small"
                    onClick={() =>
                      handleReactivate(customer.id)
                    }
                  >
                    Reactivate
                  </Button>
                )}
              </TableCell>

            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}