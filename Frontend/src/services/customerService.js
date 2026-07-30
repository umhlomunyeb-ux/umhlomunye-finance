import { supabase } from "../lib/supabase";

export async function getCustomers() {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data;
}

export async function addCustomer(customer) {
  const { data, error } = await supabase
    .from("customers")
    .insert([customer])
    .select();

  if (error) throw error;

  return data;
}

export async function updateCustomer(id, customer) {
  const { data, error } = await supabase
    .from("customers")
    .update(customer)
    .eq("id", id)
    .select();

  if (error) throw error;

  return data;
}

export async function deleteCustomer(id) {
  const { error } = await supabase
    .from("customers")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
export async function generateCustomerNumber() {
  const { data, error } = await supabase
    .from("customers")
    .select("customer_number")
    .order("customer_number", { ascending: false })
    .limit(1);

  if (error) throw error;

  if (!data || data.length === 0) {
    return "CUS000001";
  }

  const lastNumber = parseInt(
    data[0].customer_number.replace("CUS", ""),
    10
  );

  return `CUS${String(lastNumber + 1).padStart(6, "0")}`;
}
export async function customerExists(idNumber) {
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("id_number", idNumber)
    .maybeSingle();

  if (error) throw error;

  return !!data;
}