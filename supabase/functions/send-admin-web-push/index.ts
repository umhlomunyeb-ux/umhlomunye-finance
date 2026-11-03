import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const expectedSecret = Deno.env.get("WEB_PUSH_WEBHOOK_SECRET");
  const suppliedSecret = req.headers.get("x-webhook-secret");
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!publicKey || !privateKey || !supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Web Push server configuration is incomplete." }), { status: 500, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: admins, error: adminError } = await supabase
      .from("users")
      .select("id")
      .eq("role", "admin")
      .eq("is_active", true)
      .or("is_deleted.is.null,is_deleted.eq.false");
    if (adminError) throw adminError;
    const adminIds = (admins || []).map((admin: { id: string }) => admin.id);
    if (!adminIds.length) return new Response(JSON.stringify({ sent: 0, message: "No active administrators." }), { headers: corsHeaders });

    const { data: subscriptions, error: subscriptionError } = await supabase
      .from("web_push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", adminIds)
      .eq("is_active", true);
    if (subscriptionError) throw subscriptionError;

    webpush.setVapidDetails("mailto:umhlomunyeb@gmail.com", publicKey, privateKey);
    const notification = JSON.stringify({
      title: payload.title || "Umhlomunye Finance",
      body: payload.body || "A funding request needs your attention.",
      event_key: payload.event_key,
      url: payload.url || "/mobile/funding-requests",
      data: payload.data || {},
    });

    let sent = 0;
    const outcomes = await Promise.allSettled((subscriptions || []).map(async (subscription: any) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, notification, { TTL: 60 * 60 * 24 });
        sent += 1;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await supabase.from("web_push_subscriptions").update({ is_active: false }).eq("id", subscription.id);
        }
        throw error;
      }
    }));
    const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    return new Response(JSON.stringify({ sent, failed, subscriptions: subscriptions?.length || 0 }), { headers: corsHeaders });
  } catch (error) {
    console.error("Web Push delivery failed", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Web Push delivery failed" }), { status: 500, headers: corsHeaders });
  }
});
