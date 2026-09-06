import { supabase } from "../lib/supabase";

export async function getCustomers(status = "active") {
  let query = supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (status === "active") {
    query = query
      .eq("is_active", true)
      .eq("is_deleted", false);
  }

  if (status === "inactive") {
    query = query
      .eq("is_active", false)
      .eq("is_deleted", true);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
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

export async function findCustomerByIdNumber(idNumber) {
  if (!idNumber || !idNumber.trim()) {
    return null;
  }

  const { data, error } = await supabase
    .from("customers")
    .select(`
      id,
      customer_number,
      first_name,
      last_name,
      id_number,
      cellphone,
      email,
      date_of_birth,
      gender,
      employer,
      occupation,
      monthly_income,
      physical_address,
      postal_address,
      alternative_phone,
      is_active,
      is_deleted
    `)
    .eq("id_number", idNumber.trim())
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export async function deactivateCustomer(id) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("customers")
    .update({
      is_active: false,
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || null,
    })
    .eq("id", id)
    .select();

  if (error) throw error;

  return data;
}

export async function reactivateCustomer(id) {
  const { data, error } = await supabase
    .from("customers")
    .update({
      is_active: true,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
    })
    .eq("id", id)
    .select();

  if (error) throw error;

  return data;
}

export async function findCustomerByDetails({
  idNumber,
  cellphone,
}) {
  // Search by ID number first
  if (idNumber && idNumber.trim()) {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id_number", idNumber.trim())
      .maybeSingle();

    if (error) throw error;

    if (data) {
      return data;
    }
  }

  // Search by cellphone second
  if (cellphone && cellphone.trim()) {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("cellphone", cellphone.trim())
      .maybeSingle();

    if (error) throw error;

    if (data) {
      return data;
    }
  }

  return null;
}