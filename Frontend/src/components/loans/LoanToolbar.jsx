import { Button, TextField } from "@mui/material";

export default function LoanToolbar({
  onAdd,
  search,
  onSearchChange,
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 20,
      }}
    >
      <TextField
        label="Search Loan"
        size="small"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Loan number or customer name"
      />

      <Button
        variant="contained"
        onClick={onAdd}
      >
        New Loan
      </Button>
    </div>
  );
}