# iPhone Web Push setup for Umhlomunye Finance

The mobile site is a Progressive Web App (PWA), not a Capacitor APK. iPhone/iPad Web Push requires iOS/iPadOS 16.4 or later and the PWA must be added to the Home Screen and opened from its icon.

## 1. Generate VAPID keys

On a trusted computer, run:

```bash
npx --yes web-push generate-vapid-keys
```

Keep the private key secret. Do not commit it, put it in frontend code, or send it in a chat message. The public key is not secret.

## 2. Configure the Supabase Edge Function secrets

In Supabase Dashboard for project `xralmilbzedtfdwwxton`, open **Edge Functions → Secrets** and add:

- `VAPID_PUBLIC_KEY`: the generated public key
- `VAPID_PRIVATE_KEY`: the generated private key
- `WEB_PUSH_WEBHOOK_SECRET`: a new random secret (for example, generate one with `openssl rand -hex 32`)

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions automatically. Do not put the service-role key in the frontend.

Deploy the function with JWT verification disabled because it validates the dedicated webhook secret itself:

```bash
supabase functions deploy send-admin-web-push --project-ref xralmilbzedtfdwwxton --no-verify-jwt
```

## 3. Store the webhook destination and matching secret in Vault

After deploying, run this in the Supabase SQL Editor. Replace the placeholder with the exact same random value used for `WEB_PUSH_WEBHOOK_SECRET` in Edge Function Secrets:

```sql
select vault.create_secret(
  'https://xralmilbzedtfdwwxton.supabase.co/functions/v1/send-admin-web-push',
  'web_push_function_url'
);

select vault.create_secret(
  'PASTE_THE_SAME_WEB_PUSH_WEBHOOK_SECRET_HERE',
  'web_push_webhook_secret'
);
```

The database trigger reads these values from Vault. If they are not present, the existing in-app alerts continue working and external push is simply skipped.

## 4. Configure the frontend build

Set `VITE_WEB_PUSH_PUBLIC_KEY` to the generated public VAPID key in the build environment used to build the Umhlomunye Finance Cloudflare Worker. This is a public key and is embedded in the browser bundle. Do not set the private key in Cloudflare's frontend build variables.

## 5. Enable it on the iPhone

1. Open the Umhlomunye Finance mobile page in Safari.
2. Use **Share → Add to Home Screen → Add**.
3. Open Umhlomunye Finance using the new Home Screen icon and sign in as an Administrator.
4. Open **Funding Requests** and tap **Enable notifications**.
5. Choose **Allow** when iOS asks.

The app stores the browser subscription against the signed-in administrator. Funding shortfall and approved top-up waiting-for-funds events are sent to all active administrator subscriptions. Expired subscriptions are deactivated automatically after a push provider returns HTTP 404/410.

## Current implementation notes

- In-app funding alerts remain available even if Web Push has not been configured.
- Push messages open the Funding Requests page when tapped.
- Reinstalling the Home Screen app or clearing Safari website data may require enabling notifications again.
- No VAPID keys are committed to this repository.
