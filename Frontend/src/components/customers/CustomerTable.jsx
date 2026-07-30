import {
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";

export default function CustomerTable({ customers }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Customer No</TableCell>
          <TableCell>Name</TableCell>
          <TableCell>ID Number</TableCell>
          <TableCell>Phone</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>

      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.id}>
            <TableCell>{customer.customer_number}</TableCell>
            <TableCell>
              {customer.first_name} {customer.last_name}
            </TableCell>
            <TableCell>{customer.id_number}</TableCell>
            <TableCell>{customer.cellphone}</TableCell>
            <TableCell>{customer.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}