import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return response({ success: true }, 200);
  }

  if (req.method !== "POST") {
    return response(
      {
        success: false,
        error: "Method not allowed.",
      },
      405,
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error("Supabase environment variables are missing.");
    }

    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return response(
        {
          success: false,
          error: "Missing authorization header.",
        },
        401,
      );
    }

    /*
     * Client using the logged-in user's JWT.
     * This is used to identify the requesting user
     * and verify the administrator profile through
     * the user's existing RLS permissions.
     */
    const supabaseAuth = createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      },
    );

    const {
      data: { user: requestingUser },
      error: authError,
    } = await supabaseAuth.auth.getUser();

    if (authError) {
      throw new Error(
        `Unable to verify requesting user: ${authError.message}`,
      );
    }

    if (!requestingUser) {
      return response(
        {
          success: false,
          error: "Authenticated user not found.",
        },
        401,
      );
    }

    /*
     * Service-role client.
     * This is required for privileged Auth operations.
     */
    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    /*
     * Verify that the requesting user is an active administrator.
     *
     * IMPORTANT:
     * Use the authenticated user's client here instead of
     * the service-role client because the users table in this
     * project is currently denying the service-role database
     * request.
     */
    const {
      data: adminProfile,
      error: adminProfileError,
    } = await supabaseAuth
      .from("users")
      .select(
        `
        id,
        username,
        full_name,
        email,
        role,
        is_active,
        is_deleted
      `,
      )
      .eq("id", requestingUser.id)
      .maybeSingle();

    if (adminProfileError) {
      throw new Error(
        `Unable to verify administrator profile: ${adminProfileError.message}`,
      );
    }

    if (!adminProfile) {
      return response(
        {
          success: false,
          error: "Administrator profile not found.",
        },
        403,
      );
    }

    if (
      String(adminProfile.role).toLowerCase() !== "admin" ||
      adminProfile.is_active !== true ||
      adminProfile.is_deleted === true
    ) {
      return response(
        {
          success: false,
          error: "Only an active administrator can create users.",
        },
        403,
      );
    }

    /*
     * Read request body.
     */
    const body = await req.json();

    const {
      username,
      full_name,
      email,
      cellphone,
      password,
      role,
    } = body || {};

    /*
     * Validate required fields.
     */
    if (!username || !String(username).trim()) {
      return response(
        {
          success: false,
          error: "Username is required.",
        },
        400,
      );
    }

    if (!full_name || !String(full_name).trim()) {
      return response(
        {
          success: false,
          error: "Full name is required.",
        },
        400,
      );
    }

    if (!email || !String(email).trim()) {
      return response(
        {
          success: false,
          error: "Email is required.",
        },
        400,
      );
    }

    if (!password) {
      return response(
        {
          success: false,
          error: "Password is required.",
        },
        400,
      );
    }

    if (String(password).length < 8) {
      return response(
        {
          success: false,
          error: "Password must be at least 8 characters.",
        },
        400,
      );
    }

    const normalizedUsername = String(username).trim();
    const normalizedFullName = String(full_name).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedCellphone = cellphone
      ? String(cellphone).trim()
      : null;

    const normalizedRole =
      String(role || "user").toLowerCase() === "admin"
        ? "admin"
        : "user";

    /*
     * Basic email validation.
     */
    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return response(
        {
          success: false,
          error: "Please enter a valid email address.",
        },
        400,
      );
    }

    /*
     * Check duplicate username.
     */
    const {
      data: existingUsername,
      error: usernameCheckError,
    } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("username", normalizedUsername)
      .eq("is_deleted", false)
      .limit(1)
      .maybeSingle();

    if (usernameCheckError) {
      throw new Error(
        `Unable to check username: ${usernameCheckError.message}`,
      );
    }

    if (existingUsername) {
      return response(
        {
          success: false,
          error: "Username already exists.",
        },
        400,
      );
    }

    /*
     * Check duplicate email in application users table.
     */
    const {
      data: existingEmail,
      error: emailCheckError,
    } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .eq("is_deleted", false)
      .limit(1)
      .maybeSingle();

    if (emailCheckError) {
      throw new Error(
        `Unable to check email: ${emailCheckError.message}`,
      );
    }

    if (existingEmail) {
      return response(
        {
          success: false,
          error: "Email address already exists.",
        },
        400,
      );
    }

    /*
     * Create the Supabase Auth user.
     */
    const {
      data: authData,
      error: createAuthError,
    } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: String(password),
      email_confirm: true,
      user_metadata: {
        full_name: normalizedFullName,
        username: normalizedUsername,
      },
    });

    if (createAuthError) {
      throw new Error(
        `Unable to create authentication user: ${createAuthError.message}`,
      );
    }

    if (!authData?.user) {
      throw new Error(
        "Supabase did not return the newly created authentication user.",
      );
    }

    const newUserId = authData.user.id;

    /*
     * Create the application user profile.
     */
    const {
      data: profile,
      error: profileError,
    } = await supabaseAdmin
      .from("users")
      .insert({
        id: newUserId,
        username: normalizedUsername,
        full_name: normalizedFullName,
        email: normalizedEmail,
        cellphone: normalizedCellphone,
        role: normalizedRole,
        is_active: true,
        is_deleted: false,
      })
      .select(
        `
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
      `,
      )
      .single();

    /*
     * If application profile creation fails,
     * remove the Auth user so we don't leave an orphaned account.
     */
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);

      throw new Error(
        `Unable to create user profile: ${profileError.message}`,
      );
    }

    return response({
      success: true,
      message: "User created successfully.",
      user: profile,
    });
  } catch (error) {
    console.error("CREATE USER ERROR:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    return response(
      {
        success: false,
        error:
          errorMessage ||
          "Unable to create user.",
      },
      400,
    );
  }
});
