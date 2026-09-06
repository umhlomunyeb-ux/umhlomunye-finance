import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")!;

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      )!;

    const anonKey =
      Deno.env.get(
        "SUPABASE_ANON_KEY"
      )!;

    /*
     * Client representing the logged-in administrator.
     */
    const authHeader =
      req.headers.get("Authorization");

    if (!authHeader) {
      throw new Error(
        "Authorization header is required."
      );
    }

    const adminClient =
      createClient(
        supabaseUrl,
        anonKey,
        {
          global: {
            headers: {
              Authorization:
                authHeader,
            },
          },
        }
      );

    const {
      data: {
        user: requestingUser,
      },
      error: authError,
    } =
      await adminClient.auth.getUser();

    if (
      authError ||
      !requestingUser
    ) {
      throw new Error(
        "You must be authenticated."
      );
    }

    /*
     * Service-role client.
     * NEVER expose this key to React.
     */
    const serviceClient =
      createClient(
        supabaseUrl,
        serviceRoleKey
      );

    /*
     * Verify administrator role.
     */
    const {
      data: adminProfile,
      error: profileError,
    } =
      await serviceClient
        .from("users")
        .select(`
          id,
          role,
          is_active,
          is_deleted
        `)
        .eq(
          "id",
          requestingUser.id
        )
        .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (
      !adminProfile ||
      String(
        adminProfile.role
      ).toLowerCase() !== "admin" ||
      adminProfile.is_active === false ||
      adminProfile.is_deleted === true
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Only an Administrator can create users.",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    const body = await req.json();

    const {
      email,
      password,
      username,
      full_name,
      cellphone,
      role,
    } = body;

    if (!email) {
      throw new Error(
        "Email is required."
      );
    }

    if (!password) {
      throw new Error(
        "Password is required."
      );
    }

    if (!username) {
      throw new Error(
        "Username is required."
      );
    }

    if (!full_name) {
      throw new Error(
        "Full name is required."
      );
    }

    const allowedRoles = [
      "admin",
      "user",
    ];

    const selectedRole =
      String(role || "user")
        .toLowerCase();

    if (
      !allowedRoles.includes(
        selectedRole
      )
    ) {
      throw new Error(
        "Invalid user role."
      );
    }

    /*
     * Create Supabase Auth account.
     */
    const {
      data: authData,
      error: createAuthError,
    } =
      await serviceClient.auth.admin
        .createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name,
            username,
          },
        });

    if (createAuthError) {
      throw createAuthError;
    }

    const authUser =
      authData.user;

    if (!authUser) {
      throw new Error(
        "Auth user was not created."
      );
    }

    /*
     * Create application user profile.
     */
    const {
      data: profile,
      error: insertError,
    } =
      await serviceClient
        .from("users")
        .insert({
          id: authUser.id,
          username,
          full_name,
          email,
          cellphone:
            cellphone || null,
          role: selectedRole,
          is_active: true,
          is_deleted: false,
        })
        .select()
        .single();

    if (insertError) {
      /*
       * Roll back the Auth user if
       * profile creation fails.
       */
      await serviceClient.auth.admin
        .deleteUser(authUser.id);

      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: profile,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "CREATE USER ERROR:",
      error
    );

    return new Response(
      JSON.stringify({
        success: false,
        error:
          error?.message ||
          "Unable to create user.",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      }
    );
  }
});