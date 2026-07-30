import { useEffect, useState } from "react";

import CustomerToolbar from "../../components/customers/CustomerToolbar";
import CustomerTable from "../../components/customers/CustomerTable";
import CustomerForm from "./CustomerForm";

import { getCustomers } from "../../services/customerService";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadCustomers();
  }, []);

  async function loadCustomers() {
    const data = await getCustomers();
    setCustomers(data);
  }

  return (
    <>
      <CustomerToolbar onAdd={() => setOpen(true)} />

      <CustomerTable customers={customers} />

      <CustomerForm
        open={open}
        onClose={() => setOpen(false)}
        onSaved={loadCustomers}
      />
    </>
  );
}