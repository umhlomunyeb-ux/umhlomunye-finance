import { useEffect, useState } from "react";

import CustomerToolbar from "../../components/customers/CustomerToolbar";
import CustomerTable from "../../components/customers/CustomerTable";
import CustomerForm from "./CustomerForm";

import { getCustomers } from "../../services/customerService";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadCustomers();
  }, [status]);

  async function loadCustomers() {
    try {
      const data = await getCustomers(status);

      setCustomers(data || []);
      setFilteredCustomers(data || []);
    } catch (error) {
      console.error("Failed to load customers:", error);
    }
  }

  useEffect(() => {
    const searchTerm = search.trim().toLowerCase();

    if (!searchTerm) {
      setFilteredCustomers(customers);
      return;
    }

    const results = customers.filter((customer) => {
      return (
        customer.customer_number
          ?.toLowerCase()
          .includes(searchTerm) ||
        customer.first_name
          ?.toLowerCase()
          .includes(searchTerm) ||
        customer.last_name
          ?.toLowerCase()
          .includes(searchTerm) ||
        customer.id_number
          ?.toLowerCase()
          .includes(searchTerm) ||
        customer.cellphone
          ?.toLowerCase()
          .includes(searchTerm)
      );
    });

    setFilteredCustomers(results);
  }, [search, customers]);

  return (
    <>
      <CustomerToolbar
        onAdd={() => setOpen(true)}
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
      />

      <CustomerTable
        customers={filteredCustomers}
        onChanged={loadCustomers}
      />

      <CustomerForm
        open={open}
        onClose={() => setOpen(false)}
        onSaved={loadCustomers}
      />
    </>
  );
}