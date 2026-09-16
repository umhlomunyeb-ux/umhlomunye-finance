import { supabase } from "../lib/supabase";

/**
 * Get the currently authenticated user's profile
 * from the public.users table.
 */
export async function getCurrentUserProfile() {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error("getCurrentUserProfile auth error:", authError);
    throw authError;
  }

  if (!user) {
    return null;
  }

  console.log("CURRENT AUTH USER:", user.id, user.email);

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  console.log("CURRENT USER PROFILE:", data);
  console.log("CURRENT USER PROFILE ERROR:", error);

  if (error) {
    console.error("getCurrentUserProfile:", error);
    throw error;
  }

  return data;
}

/**
 * Check whether the currently authenticated user
 * is an active administrator.
 */
export async function isCurrentUserAdmin() {
  const profile = await getCurrentUserProfile();

  return (
    profile &&
    String(profile.role).toLowerCase() === "admin" &&
    profile.is_active !== false &&
    profile.is_deleted !== true
  );
}

/**
 * Get all non-deleted users.
 */
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
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getUsers:", error);
    throw error;
  }

  return data || [];
}

/**
 * Create a new user through the protected
 * create-user-admin Edge Function.
 *
 * The Edge Function is responsible for:
 * - Admin authorization
 * - Password validation
 * - Duplicate checking
 * - Supabase Auth user creation
 * - users table profile creation
 */
export async function createUser(userData) {
  const { data, error } = await supabase.functions.invoke(
    "create-user-admin",
    {
      body: userData,
    }
  );

  if (error) {
    console.error("createUser Functions error:", error);

    /*
     * Supabase FunctionsHttpError can contain the
     * actual Edge Function Response in error.context.
     *
     * Read it so that the real backend error is shown
     * instead of only:
     * "Edge Function returned a non-2xx status code."
     */
    if (error.context) {
      try {
        const errorBody = await error.context.json();

        console.error(
          "createUser Edge Function response:",
          errorBody
        );

        throw new Error(
          errorBody?.error ||
            "The create-user-admin function returned an error."
        );
      } catch (parseError) {
        /*
         * If the response was already converted into
         * an Error above, pass that useful message through.
         */
        if (parseError instanceof Error) {
          throw parseError;
        }
      }
    }

    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.error || "Unable to create user."
    );
  }

  return data.user;
}

/**
 * Update an existing user through the protected
 * manage-user-admin Edge Function.
 *
 * Supported fields include:
 * - username
 * - full_name
 * - email
 * - cellphone
 * - role
 * - is_active
 * - password
 */
export async function updateUser(userId, userData) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  const { data, error } = await supabase.functions.invoke(
    "manage-user-admin",
    {
      body: {
        action: "update",
        user_id: userId,
        ...userData,
      },
    }
  );

  if (error) {
    console.error("updateUser Functions error:", error);

    if (error.context) {
      try {
        const errorBody = await error.context.json();

        console.error(
          "updateUser Edge Function response:",
          errorBody
        );

        throw new Error(
          errorBody?.error ||
            "The manage-user-admin function returned an error."
        );
      } catch (parseError) {
        if (parseError instanceof Error) {
          throw parseError;
        }
      }
    }

    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.error || "Unable to update user."
    );
  }

  return data.user;
}

/**
 * Soft-delete a user through the protected
 * manage-user-admin Edge Function.
 *
 * The backend preserves the user's historical
 * database records and disables their Auth account.
 */
export async function deleteUser(userId) {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  const { data, error } = await supabase.functions.invoke(
    "manage-user-admin",
    {
      body: {
        action: "delete",
        user_id: userId,
      },
    }
  );

  if (error) {
    console.error("deleteUser Functions error:", error);

    if (error.context) {
      try {
        const errorBody = await error.context.json();

        console.error(
          "deleteUser Edge Function response:",
          errorBody
        );

        throw new Error(
          errorBody?.error ||
            "The manage-user-admin function returned an error."
        );
      } catch (parseError) {
        if (parseError instanceof Error) {
          throw parseError;
        }
      }
    }

    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.error || "Unable to delete user."
    );
  }

  return data;
}
