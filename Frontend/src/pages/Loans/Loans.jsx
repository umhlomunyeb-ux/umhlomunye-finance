import { useState } from "react";
import LoanToolbar from "../../components/loans/LoanToolbar";
import LoanTable from "../../components/loans/LoanTable";
import LoanForm from "./LoanForm";

export default function Loans() {
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");

  function handleSaved() {
    setOpen(false);
    setRefreshKey((prev) => prev + 1);
  }

  return (
    <>
      <LoanToolbar
        onAdd={() => setOpen(true)}
        search={search}
        onSearchChange={setSearch}
      />

      <LoanTable
        refreshKey={refreshKey}
        search={search}
      />

      <LoanForm
        open={open}
        onClose={() => setOpen(false)}
        onSaved={handleSaved}
      />
    </>
  );
}