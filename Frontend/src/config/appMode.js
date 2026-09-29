const APP_MODE = String(
  import.meta.env.VITE_APP_MODE || "online"
)
  .trim()
  .toLowerCase();

const LOCAL_API_URL = String(
  import.meta.env.VITE_LOCAL_API_URL ||
    "http://127.0.0.1:5000"
).replace(/\/+$/, "");

export const isOfflineMode =
  APP_MODE === "offline";

export const isOnlineMode =
  !isOfflineMode;

export const appMode =
  isOfflineMode ? "offline" : "online";

export const localApiUrl =
  LOCAL_API_URL;

export function getAppMode() {
  return appMode;
}