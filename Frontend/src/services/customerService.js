import { supabase } from "../lib/supabase";
import {
  isOfflineMode,
  localApiUrl,
} from "../config/appMode";

async function localRequest(
  path,
  options = {}
) {
  const token =
    localStorage.getItem(
      "lms_local_auth_token"
    );

  const response = await fetch(
    `${localApiUrl}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {}),
        ...(options.headers || {}),
      },
    }
  );

  let result = null;

  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    throw new Error(
      result?.error ||
        "Local customer request failed."
    );
  }

  return result;
}

export async function getCustomers(
  status = "active"
) {
  if (isOfflineMode) {
    const result =
      await localRequest(
        `/api/customers?status=${encodeURIComponent(
          status
        )}`
      );

    return result?.customers || [];
  }

  let query = supabase
    .from("customers")
    .select("*")
    .order("created_at", {
      ascending: false,
    });

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

  const { data, error } =
    await query;

  if (error) {
    throw error;
  }

  return data || [];
}

export async function addCustomer(
  customer
) {
  if (isOfflineMode) {
    const result =
      await localRequest(
        "/api/customers",
        {
          method: "POST",
          body: JSON.stringify(
            customer
          ),
        }
      );

    return result?.customer
      ? [result.customer]
      : [];
  }

  const { data, error } =
    await supabase
      .from("customers")
      .insert([customer])
      .select();

  if (error) throw error;

  return data;
}

export async function updateCustomer(
  id,
  customer
) {
  if (isOfflineMode) {
    const result =
      await localRequest(
        `/api/customers/${encodeURIComponent(
          id
        )}`,
        {
          method: "PATCH",
          body: JSON.stringify(
            customer
          ),
        }
      );

    return result?.customer
      ? [result.customer]
      : [];
  }

  const { data, error } =
    await supabase
      .from("customers")
      .update(customer)
      .eq("id", id)
      .select();

  if (error) throw error;

  return data;
}

export async function deleteCustomer(
  id
) {
  if (isOfflineMode) {
    await localRequest(
      `/api/customers/${encodeURIComponent(
        id
      )}`,
      {
        method: "DELETE",
      }
    );

    return;
  }

  const { error } =
    await supabase
      .from("customers")
      .delete()
      .eq("id", id);

  if (error) throw error;
}

export async function generateCustomerNumber() {
  if (isOfflineMode) {
    const result =
      await localRequest(
        "/api/customers/number"
      );

    return (
      result?.customer_number ||
      "CUS000001"
    );
  }

  const { data, error } =
    await supabase
      .from("customers")
      .select("customer_number")
      .order("customer_number", {
        ascending: false,
      })
      .limit(1);

  if (error) throw error;

  if (!data || data.length === 0) {
    return "CUS000001";
  }

  const lastNumber = parseInt(
    data[0].customer_number.replace(
      "CUS",
      ""
    ),
    10
  );

  return `CUS${String(
    lastNumber + 1
  ).padStart(6, "0")}`;
}

export async function customerExists(
  idNumber
) {
  if (isOfflineMode) {
    if (
      !idNumber ||
      !idNumber.trim()
    ) {
      return false;
    }

    const result =
      await localRequest(
        `/api/customers/exists?id_number=${encodeURIComponent(
          idNumber.trim()
        )}`
      );

    return Boolean(
      result?.exists
    );
  }

  const { data, error } =
    await supabase
      .from("customers")
      .select("id")
      .eq("id_number", idNumber)
      .maybeSingle();

  if (error) throw error;

  return !!data;
}

export async function findCustomerByIdNumber(
  idNumber
) {
  if (!idNumber || !idNumber.trim()) {
    return null;
  }

  if (isOfflineMode) {
    const result =
      await localRequest(
        `/api/customers/by-id-number?id_number=${encodeURIComponent(
          idNumber.trim()
        )}`
      );

    return result?.customer || null;
  }

  const { data, error } =
    await supabase
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
      .eq(
        "id_number",
        idNumber.trim()
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export async function deactivateCustomer(
  id
) {
  if (isOfflineMode) {
    const result =
      await localRequest(
        `/api/customers/${encodeURIComponent(
          id
        )}/deactivate`,
        {
          method: "PATCH",
        }
      );

    return result?.customer
      ? [result.customer]
      : [];
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } =
    await supabase
      .from("customers")
      .update({
        is_active: false,
        is_deleted: true,
        deleted_at:
          new Date().toISOString(),
        deleted_by:
          user?.id || null,
      })
      .eq("id", id)
      .select();

  if (error) throw error;

  return data;
}

export async function reactivateCustomer(
  id
) {
  if (isOfflineMode) {
    const result =
      await localRequest(
        `/api/customers/${encodeURIComponent(
          id
        )}/reactivate`,
        {
          method: "PATCH",
        }
      );

    return result?.customer
      ? [result.customer]
      : [];
  }

  const { data, error } =
    await supabase
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
  if (isOfflineMode) {
    const params =
      new URLSearchParams();

    if (
      idNumber &&
      idNumber.trim()
    ) {
      params.set(
        "id_number",
        idNumber.trim()
      );
    }

    if (
      cellphone &&
      cellphone.trim()
    ) {
      params.set(
        "cellphone",
        cellphone.trim()
      );
    }

    const result =
      await localRequest(
        `/api/customers/by-details?${params.toString()}`
      );

    return result?.customer || null;
  }

  if (idNumber && idNumber.trim()) {
    const { data, error } =
      await supabase
        .from("customers")
        .select("*")
        .eq(
          "id_number",
          idNumber.trim()
        )
        .maybeSingle();

    if (error) throw error;

    if (data) {
      return data;
    }
  }

  if (cellphone && cellphone.trim()) {
    const { data, error } =
      await supabase
        .from("customers")
        .select("*")
        .eq(
          "cellphone",
          cellphone.trim()
        )
        .maybeSingle();

    if (error) throw error;

    if (data) {
      return data;
    }
  }

  return null;
}

export async function getCustomerById(
  id
) {
  if (isOfflineMode) {
    const result =
      await localRequest(
        `/api/customers/${encodeURIComponent(
          id
        )}`
      );

    return result?.customer || null;
  }

  const { data, error } =
    await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .single();

  if (error) {
    throw error;
  }

  return data;
}