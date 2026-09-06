import {
  Box,
  Button,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";

export default function CustomerToolbar({
  onAdd,
  search,
  onSearchChange,
  status,
  onStatusChange,
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        mb: 3,
        flexWrap: "wrap",
      }}
    >
      <Typography variant="h4">
        Customers
      </Typography>

      <TextField
        size="small"
        label="Search customers"
        placeholder="Name, ID, cellphone..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        sx={{
          minWidth: 280,
        }}
      />

      <FormControl
        size="small"
        sx={{
          minWidth: 180,
        }}
      >
        <InputLabel>Status</InputLabel>

        <Select
          value={status}
          label="Status"
          onChange={(e) =>
            onStatusChange(e.target.value)
          }
        >
          <MenuItem value="active">
            Active Customers
          </MenuItem>

          <MenuItem value="inactive">
            Inactive Customers
          </MenuItem>

          <MenuItem value="all">
            All Customers
          </MenuItem>
        </Select>
      </FormControl>

      <Button
        variant="contained"
        onClick={onAdd}
      >
        Add Customer
      </Button>
    </Box>
  );
}