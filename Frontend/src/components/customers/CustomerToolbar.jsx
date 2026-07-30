import { Button, TextField } from "@mui/material";

export default function CustomerToolbar({ onAdd }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 20,
      }}
    >
      <TextField
        label="Search Customer"
        size="small"
      />

      <Button
        variant="contained"
        onClick={onAdd}
      >
        New Customer
      </Button>
    </div>
  );
}