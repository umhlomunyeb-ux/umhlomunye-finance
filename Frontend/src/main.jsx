import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

import App from "./App";
import theme from "./theme/theme";
import { AuthProvider } from "./context/AuthContext";
import { getSystemSettings } from "./services/settingsService";

async function applyBrowserBranding() {
  try {
    const settings = await getSystemSettings();

    const companyName =
      typeof settings?.company_name === "string"
        ? settings.company_name.trim()
        : "";

    const logoUrl =
      typeof settings?.company_logo_url === "string"
        ? settings.company_logo_url.trim()
        : "";

    if (companyName) {
      document.title = companyName;
    }

    if (logoUrl) {
      let favicon = document.querySelector('link[rel="icon"]');

      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.appendChild(favicon);
      }

      favicon.type = "image/*";
      favicon.href = logoUrl;
    }
  } catch (error) {
    console.warn("Unable to load browser branding:", error);
  }
}

applyBrowserBranding();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <AuthProvider>
        <App />
      </AuthProvider>
      
    </ThemeProvider>
  </React.StrictMode>
);
