import { supabase } from "../lib/supabase";
import {
  isOfflineMode,
  localApiUrl,
} from "../config/appMode";

const LOCAL_AUTH_TOKEN_KEY =
  "lms_local_auth_token";

function getStoredLocalToken() {
  try {
    return localStorage.getItem(
      LOCAL_AUTH_TOKEN_KEY
    );
  } catch (error) {
    console.error(
      "LOCAL AUTH TOKEN READ ERROR:",
      error
    );

    return null;
  }
}

function storeLocalToken(token) {
  try {
    if (token) {
      localStorage.setItem(
        LOCAL_AUTH_TOKEN_KEY,
        token
      );
    }
  } catch (error) {
    console.error(
      "LOCAL AUTH TOKEN STORE ERROR:",
      error
    );
  }
}

function clearLocalToken() {
  try {
    localStorage.removeItem(
      LOCAL_AUTH_TOKEN_KEY
    );
  } catch (error) {
    console.error(
      "LOCAL AUTH TOKEN CLEAR ERROR:",
      error
    );
  }
}

async function localRequest(
  path,
  options = {}
) {
  const token =
    options.token ??
    getStoredLocalToken();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response = await fetch(
    `${localApiUrl}${path}`,
    {
      ...options,
      headers,
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.error ||
        data?.message ||
        `Authentication request failed (${response.status}).`
    );

    error.status =
      response.status;

    error.data = data;

    throw error;
  }

  return data;
}

/**
 * ------------------------------------------------------------
 * LOGIN
 * ------------------------------------------------------------
 */

export async function signIn(
  email,
  password
) {
  if (isOfflineMode) {
    const data =
      await localRequest(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
          }),
          token: null,
        }
      );

    if (data?.token) {
      storeLocalToken(
        data.token
      );
    }

    return {
      user: data?.user ?? null,
      error: null,
    };
  }

  const {
    data,
    error,
  } =
    await supabase.auth.signInWithPassword(
      {
        email,
        password,
      }
    );

  return {
    user: data?.user ?? null,
    session:
      data?.session ?? null,
    error,
  };
}

/**
 * ------------------------------------------------------------
 * GET CURRENT SESSION / USER
 * ------------------------------------------------------------
 */

export async function getCurrentUser() {
  if (isOfflineMode) {
    const token =
      getStoredLocalToken();

    if (!token) {
      return null;
    }

    try {
      const data =
        await localRequest(
          "/api/auth/me",
          {
            method: "GET",
            token,
          }
        );

      return data?.user ?? null;
    } catch (error) {
      if (
        error?.status === 401 ||
        error?.status === 403
      ) {
        clearLocalToken();
      }

      console.error(
        "LOCAL CURRENT USER ERROR:",
        error
      );

      return null;
    }
  }

  const {
    data,
    error,
  } =
    await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return data?.user ?? null;
}

/**
 * ------------------------------------------------------------
 * SESSION
 * ------------------------------------------------------------
 */

export async function getSession() {
  if (isOfflineMode) {
    const token =
      getStoredLocalToken();

    if (!token) {
      return null;
    }

    try {
      const user =
        await getCurrentUser();

      if (!user) {
        return null;
      }

      return {
        access_token: token,
        user,
      };
    } catch (error) {
      console.error(
        "LOCAL SESSION ERROR:",
        error
      );

      return null;
    }
  }

  const {
    data,
    error,
  } =
    await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data?.session ?? null;
}

/**
 * ------------------------------------------------------------
 * LOGOUT
 * ------------------------------------------------------------
 */

export async function signOut() {
  if (isOfflineMode) {
    try {
      const token =
        getStoredLocalToken();

      if (token) {
        await localRequest(
          "/api/auth/logout",
          {
            method: "POST",
            token,
          }
        );
      }
    } catch (error) {
      console.error(
        "LOCAL LOGOUT ERROR:",
        error
      );
    } finally {
      clearLocalToken();
    }

    return {
      error: null,
    };
  }

  const {
    error,
  } =
    await supabase.auth.signOut();

  return {
    error,
  };
}

/**
 * ------------------------------------------------------------
 * AUTH STATE CHANGE
 * ------------------------------------------------------------
 *
 * Online mode uses the existing Supabase
 * auth subscription.
 *
 * Offline mode does not have a Supabase
 * auth event stream, so AuthContext performs
 * the initial local session check.
 */

export function onAuthStateChange(
  callback
) {
  if (isOfflineMode) {
    return {
      data: {
        subscription: {
          unsubscribe() {},
        },
      },
    };
  }

  return supabase.auth.onAuthStateChange(
    callback
  );
}

/**
 * ------------------------------------------------------------
 * PASSWORD RESET
 * ------------------------------------------------------------
 */

export async function resetPasswordForEmail(
  email,
  options = {}
) {
  if (isOfflineMode) {
    throw new Error(
      "Password reset by email is not available while the LMS is running offline."
    );
  }

  return supabase.auth.resetPasswordForEmail(
    email,
    options
  );
}

/**
 * ------------------------------------------------------------
 * LOCAL AUTH TOKEN
 * ------------------------------------------------------------
 */

export function hasLocalAuthToken() {
  return Boolean(
    getStoredLocalToken()
  );
}

export function clearLocalAuthSession() {
  clearLocalToken();
}