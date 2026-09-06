import { supabase } from "../lib/supabase";

export async function getCurrentUserProfile() {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw authError;
  }

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error(
      "getCurrentUserProfile:",
      error
    );

    throw error;
  }

  return data;
}

export async function isCurrentUserAdmin() {
  const profile =
    await getCurrentUserProfile();

  return (
    profile &&
    String(profile.role).toLowerCase() ===
      "admin" &&
    profile.is_active !== false &&
    profile.is_deleted !== true
  );
}

export async function getUsers() {
  const { data, error } = await supabase
    .from("users")
    .select(`
      id,
      username,
      full_name,
      email,
      cellphone,
      role,
      is_active,
      is_deleted,
      created_at,
      updated_at
    `)
    .eq("is_deleted", false)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error("getUsers:", error);
    throw error;
  }

  return data || [];
}

export async function createUser(userData) {
  const {
    data,
    error,
  } = await supabase.functions.invoke(
    "create-user-admin",
    {
      body: userData,
    }
  );

  if (error) {
    console.error(
      "createUser:",
      error
    );

    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.error ||
        "Unable to create user."
    );
  }

  return data.user;
}