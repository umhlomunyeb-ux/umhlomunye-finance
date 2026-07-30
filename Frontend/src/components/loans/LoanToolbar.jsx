import { Button, TextField } from "@mui/material";

export default function LoanToolbar({ onAdd }) {
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