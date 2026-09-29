import { supabase } from "../lib/supabase";

import {
  getCurrentUser,
} from "./authService";

import {
  isOfflineMode,
  localApiUrl,
} from "../config/appMode";

/**
 * Get the currently authenticated user's profile
 * from the public.users table.
 *
 * ONLINE:
 *   Supabase Auth -> public.users
 *
 * OFFLINE:
 *   Local authentication -> local PostgreSQL users
 */
export async function getCurrentUserProfile() {
  if (isOfflineMode) {
    const user = await getCurrentUser();

    if (!user) {
      return null;
    }

    return user;
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error(
      "getCurrentUserProfile auth error:",
      authError
    );

    throw authError;
  }

  if (!user) {
    return null;
  }

  console.log(
    "CURRENT AUTH USER:",
    user.id,
    user.email
  );

  const {
    data,
    error,
  } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  console.log(
    "CURRENT USER PROFILE:",
    data
  );

  console.log(
    "CURRENT USER PROFILE ERROR:",
    error
  );

  if (error) {
    console.error(
      "getCurrentUserProfile:",
      error
    );

    throw error;
  }

  return data;
}

/**
 * Check whether the currently authenticated user
 * is an active administrator.
 */
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

/**
 * Get all non-deleted users.
 *
 * ONLINE:
 *   Supabase
 *
 * OFFLINE:
 *   Local API
 */
export async function getUsers() {
  if (isOfflineMode) {
    const token =
      localStorage.getItem(
        "lms_local_auth_token"
      );

    const response = await fetch(
      `${localApiUrl}/api/users`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error ||
          "Unable to load users."
      );
    }

    return Array.isArray(data?.users)
      ? data.users
      : [];
  }

  const {
    data,
    error,
  } = await supabase
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
    console.error(
      "getUsers:",
      error
    );

    throw error;
  }

  return data || [];
}

/**
 * Create a new user.
 *
 * ONLINE:
 *   Protected Supabase Edge Function.
 *
 * OFFLINE:
 *   Local API.
 */
export async function createUser(
  userData
) {
  if (isOfflineMode) {
    const token =
      localStorage.getItem(
        "lms_local_auth_token"
      );

    const response = await fetch(
      `${localApiUrl}/api/users`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${token}`,
        },
        body: JSON.stringify(
          userData
        ),
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error ||
          "Unable to create user."
      );
    }

    return data.user;
  }

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
      "createUser Functions error:",
      error
    );

    if (error.context) {
      try {
        const errorBody =
          await error.context.json();

        console.error(
          "createUser Edge Function response:",
          errorBody
        );

        throw new Error(
          errorBody?.error ||
            "The create-user-admin function returned an error."
        );
      } catch (parseError) {
        if (
          parseError instanceof Error
        ) {
          throw parseError;
        }
      }
    }

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

/**
 * Update an existing user.
 */
export async function updateUser(
  userId,
  userData
) {
  if (!userId) {
    throw new Error(
      "User ID is required."
    );
  }

  if (isOfflineMode) {
    const token =
      localStorage.getItem(
        "lms_local_auth_token"
      );

    const response = await fetch(
      `${localApiUrl}/api/users/${encodeURIComponent(
        userId
      )}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${token}`,
        },
        body: JSON.stringify(
          userData
        ),
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error ||
          "Unable to update user."
      );
    }

    return data.user;
  }

  const {
    data,
    error,
  } = await supabase.functions.invoke(
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
    console.error(
      "updateUser Functions error:",
      error
    );

    if (error.context) {
      try {
        const errorBody =
          await error.context.json();

        console.error(
          "updateUser Edge Function response:",
          errorBody
        );

        throw new Error(
          errorBody?.error ||
            "The manage-user-admin function returned an error."
        );
      } catch (parseError) {
        if (
          parseError instanceof Error
        ) {
          throw parseError;
        }
      }
    }

    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.error ||
        "Unable to update user."
    );
  }

  return data.user;
}

/**
 * Soft-delete a user.
 */
export async function deleteUser(
  userId
) {
  if (!userId) {
    throw new Error(
      "User ID is required."
    );
  }

  if (isOfflineMode) {
    const token =
      localStorage.getItem(
        "lms_local_auth_token"
      );

    const response = await fetch(
      `${localApiUrl}/api/users/${encodeURIComponent(
        userId
      )}`,
      {
        method: "DELETE",
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error ||
          "Unable to delete user."
      );
    }

    return data;
  }

  const {
    data,
    error,
  } = await supabase.functions.invoke(
    "manage-user-admin",
    {
      body: {
        action: "delete",
        user_id: userId,
      },
    }
  );

  if (error) {
    console.error(
      "deleteUser Functions error:",
      error
    );

    if (error.context) {
      try {
        const errorBody =
          await error.context.json();

        console.error(
          "deleteUser Edge Function response:",
          errorBody
        );

        throw new Error(
          errorBody?.error ||
            "The manage-user-admin function returned an error."
        );
      } catch (parseError) {
        if (
          parseError instanceof Error
        ) {
          throw parseError;
        }
      }
    }

    throw error;
  }

  if (!data?.success) {
    throw new Error(
      data?.error ||
        "Unable to delete user."
    );
  }

  return data;
}