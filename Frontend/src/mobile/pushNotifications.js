import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

import { supabase } from "../lib/supabase";

const APP_ID = "za.co.umhlomunye.finance";
const PLATFORM = "android";

let notificationListeners = [];
let initialized = false;

export async function initializePushNotifications(user) {
  if (!Capacitor.isNativePlatform()) {
    console.log("[Push] Not running on a native platform.");
    return null;
  }

  if (!user?.id) {
    console.log("[Push] No authenticated user.");
    return null;
  }

  /*
   * Prevent duplicate listener registration.
   */
  if (initialized) {
    console.log("[Push] Notifications already initialized.");
    return null;
  }

  initialized = true;

  try {
    console.log("[Push] Initializing notifications...");

    /*
     * Check current notification permission.
     */
    let permissionStatus =
      await PushNotifications.checkPermissions();

    console.log(
      "[Push] Current permission:",
      permissionStatus.receive
    );

    /*
     * Request permission if necessary.
     */
    if (permissionStatus.receive !== "granted") {
      permissionStatus =
        await PushNotifications.requestPermissions();

      console.log(
        "[Push] Permission after request:",
        permissionStatus.receive
      );
    }

    /*
     * Stop if Android notification permission was denied.
     */
    if (permissionStatus.receive !== "granted") {
      console.warn(
        "[Push] Notification permission was not granted."
      );

      initialized = false;

      return null;
    }

    /*
     * FCM registration.
     */
    const registrationListener =
      await PushNotifications.addListener(
        "registration",
        async (token) => {
          console.log(
            "[Push] FCM registration successful."
          );

          await savePushToken(
            user.id,
            token.value
          );
        }
      );

    notificationListeners.push(
      registrationListener
    );

    /*
     * Registration errors.
     */
    const registrationErrorListener =
      await PushNotifications.addListener(
        "registrationError",
        (error) => {
          console.error(
            "[Push] FCM registration error:",
            error
          );
        }
      );

    notificationListeners.push(
      registrationErrorListener
    );

    /*
     * Notification received while the app is running.
     */
    const receivedListener =
      await PushNotifications.addListener(
        "pushNotificationReceived",
        (notification) => {
          console.log(
            "[Push] Notification received:",
            notification
          );
        }
      );

    notificationListeners.push(
      receivedListener
    );

    /*
     * Notification tapped by the user.
     */
    const actionListener =
      await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          console.log(
            "[Push] Notification action:",
            action
          );

          handleNotificationAction(action);
        }
      );

    notificationListeners.push(
      actionListener
    );

    /*
     * Register this Android device with FCM.
     */
    await PushNotifications.register();

    console.log(
      "[Push] Device registered for push notifications."
    );

    /*
     * Return cleanup function.
     *
     * IMPORTANT:
     * This only removes JavaScript listeners.
     * It does NOT delete the FCM token from Supabase.
     *
     * Therefore, logging out does not stop this device
     * from receiving notifications.
     */
    return async () => {
      await cleanupPushListeners();
    };
  } catch (error) {
    console.error(
      "[Push] Failed to initialize push notifications:",
      error
    );

    initialized = false;

    return null;
  }
}

/*
 * Save or update the device's FCM token.
 */
async function savePushToken(userId, token) {
  if (!userId || !token) {
    console.warn(
      "[Push] Cannot save token. Missing user ID or token."
    );

    return;
  }

  try {
    const now = new Date().toISOString();

    console.log(
      "[Push] Saving FCM token..."
    );

    const { error } = await supabase
      .from("user_push_tokens")
      .upsert(
        {
          user_id: userId,
          token,
          platform: PLATFORM,
          app_id: APP_ID,
          is_active: true,
          last_seen_at: now,
          updated_at: now,
        },
        {
          onConflict: "token",
        }
      );

    if (error) {
      console.error(
        "[Push] Failed to save FCM token:",
        error
      );

      return;
    }

    console.log(
      "[Push] FCM token saved successfully."
    );
  } catch (error) {
    console.error(
      "[Push] Unexpected error while saving FCM token:",
      error
    );
  }
}

/*
 * Handle the user tapping a push notification.
 */
function handleNotificationAction(action) {
  const notification = action?.notification;

  if (!notification) {
    console.warn(
      "[Push] No notification data found."
    );

    return;
  }

  const data = notification.data || {};

  const applicationId =
    data.application_id ||
    data.applicationId;

  /*
   * If this notification is not associated with
   * an application, there is nowhere specific to navigate.
   */
  if (!applicationId) {
    console.log(
      "[Push] Notification has no application ID."
    );

    return;
  }

  console.log(
    "[Push] Opening application:",
    applicationId
  );

  window.location.href =
    `/mobile/application-review/${applicationId}`;
}

/*
 * Remove JavaScript listeners.
 *
 * This does NOT:
 * - delete the FCM token
 * - deactivate the token
 * - log the user out
 * - remove the device from user_push_tokens
 */
async function cleanupPushListeners() {
  if (notificationListeners.length === 0) {
    initialized = false;
    return;
  }

  console.log(
    "[Push] Removing notification listeners..."
  );

  for (const listener of notificationListeners) {
    try {
      await listener.remove();
    } catch (error) {
      console.warn(
        "[Push] Failed to remove notification listener:",
        error
      );
    }
  }

  notificationListeners = [];
  initialized = false;
}