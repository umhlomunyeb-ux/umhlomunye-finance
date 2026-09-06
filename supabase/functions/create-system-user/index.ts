import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      throw new Error("Missing authorization.");
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error("You must be logged in.");
    }

    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey
    );

    const { data: isAdmin, error: adminError } =
      await adminClient.rpc("is_active_admin", {
        p_user_id: user.id,
      });

    if (adminError || !isAdmin) {
      throw new Error(
        "Only active administrators can create users."
      );
    }

    const {
      email,
      password,
      full_name,
      cellphone,
      role,
    } = await req.json();

    if (!email || !password || !full_name || !role) {
      throw new Error(
        "Email, password, full name and role are required."
      );
    }

    const { data: createdUser, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createError) {
      throw createError;
    }

    const { error: profileError } = await adminClient
      .from("users")
      .insert({
        id: createdUser.user.id,
        username: email.split("@")[0],
        full_name,
        email,
        cellphone: cellphone || null,
        role,
        is_active: true,
        is_deleted: false,
      });

    if (profileError) {
      await adminClient.auth.admin.deleteUser(
        createdUser.user.id
      );

      throw profileError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: createdUser.user.id,
        message: "User created successfully.",
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to create user.",
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        status: 400,
      }
    );
  }
});