import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function normaliseRole(value) {
  return String(value || "user").trim().toLowerCase();
}
function isActiveAdmin(user) {
  return String(user?.role || "").toLowerCase() === "admin" && user?.is_active === true && user?.is_deleted !== true;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error("Required Supabase environment variables are missing.");
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return response({
        success: false,
        error: "Authorization header is required."
      }, 401);
    }
    /*
     * Client using the user's JWT.
     */ const authClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: { user: requestingUser }, error: authError } = await authClient.auth.getUser();
    if (authError || !requestingUser) {
      return response({
        success: false,
        error: "You must be authenticated."
      }, 401);
    }
    /*
     * Service-role client.
     * This is ONLY used inside the Edge Function.
     */ const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    /*
     * Verify the requesting user is an active administrator.
     */ const { data: adminProfile, error: adminProfileError } = await serviceClient.from("users").select(`
        id,
        username,
        full_name,
        email,
        role,
        is_active,
        is_deleted
      `).eq("id", requestingUser.id).maybeSingle();
    if (adminProfileError) {
      throw adminProfileError;
    }
    if (!isActiveAdmin(adminProfile)) {
      return response({
        success: false,
        error: "Only an active Administrator can manage users."
      }, 403);
    }
    const body = await req.json();
    const action = String(body?.action || "").trim().toLowerCase();
    const targetUserId = body?.user_id;
    if (!targetUserId) {
      return response({
        success: false,
        error: "User ID is required."
      }, 400);
    }
    if (![
      "update",
      "delete"
    ].includes(action)) {
      return response({
        success: false,
        error: "Invalid user management action."
      }, 400);
    }
    /*
     * Load the target user.
     */ const { data: targetUser, error: targetError } = await serviceClient.from("users").select(`
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
      `).eq("id", targetUserId).maybeSingle();
    if (targetError) {
      throw targetError;
    }
    if (!targetUser) {
      return response({
        success: false,
        error: "User not found."
      }, 404);
    }
    if (targetUser.is_deleted === true) {
      return response({
        success: false,
        error: "This user has already been deleted."
      }, 400);
    }
    /*
     * The currently logged-in administrator cannot
     * deactivate, demote or delete themselves.
     */ if (targetUser.id === requestingUser.id) {
      if (action === "delete") {
        return response({
          success: false,
          error: "You cannot delete your own administrator account."
        }, 400);
      }
      if (action === "update") {
        const requestedRole = normaliseRole(body.role ?? targetUser.role);
        const requestedActive = body.is_active === undefined ? targetUser.is_active : Boolean(body.is_active);
        if (requestedRole !== "admin" || requestedActive !== true) {
          return response({
            success: false,
            error: "You cannot deactivate or demote your own administrator account."
          }, 400);
        }
      }
    }
    /*
     * Count active administrators.
     *
     * This is the fundamental safety rule:
     *
     * There must ALWAYS be at least one active administrator.
     */ const { count: activeAdminCount, error: countError } = await serviceClient.from("users").select("id", {
      count: "exact",
      head: true
    }).eq("role", "admin").eq("is_active", true).eq("is_deleted", false);
    if (countError) {
      throw countError;
    }
    const currentActiveAdminCount = activeAdminCount || 0;
    /*
     * DELETE
     *
     * We use a soft delete in the users table and
     * disable the Auth account instead of physically
     * removing the user.
     *
     * This preserves historical loan/audit references.
     */ if (action === "delete") {
      if (isActiveAdmin(targetUser) && currentActiveAdminCount <= 1) {
        return response({
          success: false,
          error: "The last active Administrator cannot be deleted. Create or activate another Administrator first."
        }, 400);
      }
      /*
       * Disable Auth account first.
       * We deliberately do not physically delete the
       * auth.users record because historical records may
       * reference this user's UUID.
       */ const { error: banError } = await serviceClient.auth.admin.updateUserById(targetUser.id, {
        ban_duration: "876000h"
      });
      if (banError) {
        throw banError;
      }
      /*
       * Soft delete the application profile.
       */ const { data: deletedProfile, error: deleteProfileError } = await serviceClient.from("users").update({
        is_active: false,
        is_deleted: true,
        updated_at: new Date().toISOString()
      }).eq("id", targetUser.id).select().single();
      if (deleteProfileError) {
        /*
         * Try to restore Auth access if the profile update
         * failed.
         */ await serviceClient.auth.admin.updateUserById(targetUser.id, {
          ban_duration: "none"
        });
        throw deleteProfileError;
      }
      return response({
        success: true,
        message: "User deleted successfully.",
        user: deletedProfile
      });
    }
    /*
     * UPDATE
     */ const requestedRole = normaliseRole(body.role ?? targetUser.role);
    if (![
      "admin",
      "user"
    ].includes(requestedRole)) {
      return response({
        success: false,
        error: "Invalid user role."
      }, 400);
    }
    const requestedActive = body.is_active === undefined ? targetUser.is_active : Boolean(body.is_active);
    /*
     * Never allow the final active administrator
     * to become inactive or lose administrator status.
     */ const removingAdminProtection = isActiveAdmin(targetUser) && (requestedRole !== "admin" || requestedActive !== true);
    if (removingAdminProtection && currentActiveAdminCount <= 1) {
      return response({
        success: false,
        error: "The last active Administrator cannot be deactivated or changed to User."
      }, 400);
    }
    /*
     * Basic validation.
     */ const username = body.username === undefined ? targetUser.username : String(body.username || "").trim();
    const fullName = body.full_name === undefined ? targetUser.full_name : String(body.full_name || "").trim();
    const email = body.email === undefined ? targetUser.email : String(body.email || "").trim().toLowerCase();
    const cellphone = body.cellphone === undefined ? targetUser.cellphone : String(body.cellphone || "").trim();
    if (!username) {
      return response({
        success: false,
        error: "Username is required."
      }, 400);
    }
    if (!fullName) {
      return response({
        success: false,
        error: "Full name is required."
      }, 400);
    }
    if (!email) {
      return response({
        success: false,
        error: "Email is required."
      }, 400);
    }
    /*
     * Password is optional when editing.
     *
     * If supplied, enforce a stronger minimum of 8 characters.
     */ const passwordProvided = body.password !== undefined && body.password !== null && String(body.password).length > 0;
    const password = passwordProvided ? String(body.password) : null;
    if (passwordProvided && password.length < 8) {
      return response({
        success: false,
        error: "Password must be at least 8 characters."
      }, 400);
    }
    /*
     * Make sure the username is not already used
     * by another active/non-deleted user.
     */ const { data: duplicateUsername, error: duplicateUsernameError } = await serviceClient.from("users").select("id").ilike("username", username).eq("is_deleted", false).neq("id", targetUser.id).limit(1).maybeSingle();
    if (duplicateUsernameError) {
      throw duplicateUsernameError;
    }
    if (duplicateUsername) {
      return response({
        success: false,
        error: "That username is already in use."
      }, 400);
    }
    /*
     * Check duplicate email in application profiles.
     */ const { data: duplicateEmail, error: duplicateEmailError } = await serviceClient.from("users").select("id").ilike("email", email).eq("is_deleted", false).neq("id", targetUser.id).limit(1).maybeSingle();
    if (duplicateEmailError) {
      throw duplicateEmailError;
    }
    if (duplicateEmail) {
      return response({
        success: false,
        error: "That email address is already in use."
      }, 400);
    }
    /*
     * Keep the original profile so we can restore it if
     * the Auth update fails.
     */ const originalProfile = {
      username: targetUser.username,
      full_name: targetUser.full_name,
      email: targetUser.email,
      cellphone: targetUser.cellphone,
      role: targetUser.role,
      is_active: targetUser.is_active,
      is_deleted: targetUser.is_deleted
    };
    /*
     * Update application profile.
     */ const { data: updatedProfile, error: profileUpdateError } = await serviceClient.from("users").update({
      username,
      full_name: fullName,
      email,
      cellphone: cellphone || null,
      role: requestedRole,
      is_active: requestedActive,
      is_deleted: false,
      updated_at: new Date().toISOString()
    }).eq("id", targetUser.id).select().single();
    if (profileUpdateError) {
      throw profileUpdateError;
    }
    /*
     * Prepare Auth update.
     */ const authUpdate = {
      email,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username
      },
      ban_duration: requestedActive ? "none" : "876000h"
    };
    if (passwordProvided) {
      authUpdate.password = password;
    }
    /*
     * Update Supabase Auth account.
     */ const { error: authUpdateError } = await serviceClient.auth.admin.updateUserById(targetUser.id, authUpdate);
    if (authUpdateError) {
      /*
       * Roll profile back if Auth update fails.
       */ await serviceClient.from("users").update({
        ...originalProfile,
        updated_at: new Date().toISOString()
      }).eq("id", targetUser.id);
      throw authUpdateError;
    }
    return response({
      success: true,
      message: "User updated successfully.",
      user: updatedProfile
    });
  } catch (error) {
    console.error("MANAGE USER ERROR:", error);
    return response({
      success: false,
      error: error?.message || "Unable to manage user."
    }, 400);
  }
});
