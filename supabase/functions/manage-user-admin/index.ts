import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  // ---------------------------------------------------------
  // CORS / PREFLIGHT
  // ---------------------------------------------------------
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return response(
      {
        success: false,
        error: "Only POST requests are allowed.",
      },
      405,
    );
  }

  try {
    // ---------------------------------------------------------
    // ENVIRONMENT
    // ---------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error(
        "Supabase environment variables are not configured.",
      );
    }

    // ---------------------------------------------------------
    // AUTHENTICATION
    // ---------------------------------------------------------
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return response(
        {
          success: false,
          error: "Authorization header is required.",
        },
        401,
      );
    }

    /*
     * This client uses the user's JWT so auth.getUser()
     * identifies the person making the request.
     */
    const userClient = createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    );

    const {
      data: {
        user: requestingUser,
      },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !requestingUser) {
      return response(
        {
          success: false,
          error: "You must be authenticated.",
        },
        401,
      );
    }

    // ---------------------------------------------------------
    // SERVICE ROLE CLIENT
    // ---------------------------------------------------------
    const serviceClient = createClient(
      supabaseUrl,
      serviceRoleKey,
    );

    // ---------------------------------------------------------
    // VERIFY REQUESTING USER IS AN ACTIVE ADMIN
    // ---------------------------------------------------------
    const {
      data: adminProfile,
      error: profileError,
    } = await serviceClient
      .from("users")
      .select(`
        id,
        role,
        is_active,
        is_deleted
      `)
      .eq("id", requestingUser.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (
      !adminProfile ||
      String(adminProfile.role).toLowerCase() !== "admin" ||
      adminProfile.is_active === false ||
      adminProfile.is_deleted === true
    ) {
      return response(
        {
          success: false,
          error: "Only an active Administrator can create users.",
        },
        403,
      );
    }

    // ---------------------------------------------------------
    // READ REQUEST
    // ---------------------------------------------------------
    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return response(
        {
          success: false,
          error: "Invalid JSON request.",
        },
        400,
      );
    }

    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const username = String(body.username || "").trim();
    const fullName = String(body.full_name || "").trim();
    const cellphone = String(body.cellphone || "").trim();
    const selectedRole = String(body.role || "user").toLowerCase();

    // ---------------------------------------------------------
    // REQUIRED FIELDS
    // ---------------------------------------------------------
    if (!email) {
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

    // ---------------------------------------------------------
    // PASSWORD LENGTH
    // ---------------------------------------------------------
    if (password.length < 8) {
      return response(
        {
          success: false,
          error: "Password must be at least 8 characters.",
        },
        400,
      );
    }

    if (!username) {
      return response(
        {
          success: false,
          error: "Username is required.",
        },
        400,
      );
    }

    if (!fullName) {
      return response(
        {
          success: false,
          error: "Full name is required.",
        },
        400,
      );
    }

    // ---------------------------------------------------------
    // EMAIL VALIDATION
    // ---------------------------------------------------------
    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return response(
        {
          success: false,
          error: "Please enter a valid email address.",
        },
        400,
      );
    }

    // ---------------------------------------------------------
    // ROLE VALIDATION
    // ---------------------------------------------------------
    const allowedRoles = ["admin", "user"];

    if (!allowedRoles.includes(selectedRole)) {
      return response(
        {
          success: false,
          error: "Invalid user role. Choose Admin or User.",
        },
        400,
      );
    }

    // ---------------------------------------------------------
    // CHECK DUPLICATE USERNAME
    // ---------------------------------------------------------
    const {
      data: existingUsername,
      error: usernameError,
    } = await serviceClient
      .from("users")
      .select("id")
      .ilike("username", username)
      .eq("is_deleted", false)
      .maybeSingle();

    if (usernameError) {
      throw usernameError;
    }

    if (existingUsername) {
      return response(
        {
          success: false,
          error: "That username is already in use.",
        },
        409,
      );
    }

    // ---------------------------------------------------------
    // CHECK DUPLICATE EMAIL IN USERS TABLE
    // ---------------------------------------------------------
    const {
      data: existingEmail,
      error: emailError,
    } = await serviceClient
      .from("users")
      .select("id")
      .ilike("email", email)
      .eq("is_deleted", false)
      .maybeSingle();

    if (emailError) {
      throw emailError;
    }

    if (existingEmail) {
      return response(
        {
          success: false,
          error: "That email address is already in use.",
        },
        409,
      );
    }

    // ---------------------------------------------------------
    // CREATE SUPABASE AUTH USER
    // ---------------------------------------------------------
    const {
      data: authData,
      error: createAuthError,
    } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username,
      },
    });

    if (createAuthError) {
      throw createAuthError;
    }

    const authUser = authData.user;

    if (!authUser) {
      throw new Error("Auth user was not created.");
    }

    // ---------------------------------------------------------
    // CREATE USER PROFILE
    // ---------------------------------------------------------
    const {
      data: profile,
      error: insertError,
    } = await serviceClient
      .from("users")
      .insert({
        id: authUser.id,
        username,
        full_name: fullName,
        email,
        cellphone: cellphone || null,
        role: selectedRole,
        is_active: true,
        is_deleted: false,
      })
      .select()
      .single();

    // ---------------------------------------------------------
    // CLEAN UP AUTH USER IF PROFILE CREATION FAILS
    // ---------------------------------------------------------
    if (insertError) {
      try {
        await serviceClient.auth.admin.deleteUser(
          authUser.id,
        );
      } catch (cleanupError) {
        console.error(
          "AUTH USER CLEANUP ERROR:",
          cleanupError,
        );
      }

      throw insertError;
    }

    // ---------------------------------------------------------
    // SUCCESS
    // ---------------------------------------------------------
    return response(
      {
        success: true,
        message: "User created successfully.",
        user: profile,
      },
      200,
    );
  } catch (error) {
    console.error(
      "CREATE USER ERROR:",
      error,
    );

    return response(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to create user.",
      },
      400,
    );
  }
});