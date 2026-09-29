import { useEffect, useState } from "react";

import {
  getCurrentUser,
  onAuthStateChange,
} from "../../services/authService";

import {
  getCurrentUserProfile,
} from "../../services/userService";

import {
  getSystemSettings,
} from "../../services/settingsService";

export default function Header() {
  const [userName, setUserName] = useState("User");
  const [companyName, setCompanyName] = useState("");
  const [companyLogo, setCompanyLogo] = useState(null);

  useEffect(() => {
    loadHeaderData();

    const {
      data: { subscription },
    } = onAuthStateChange(() => {
      loadHeaderData();
    });

    return () => {
      subscription?.unsubscribe?.();
    };
  }, []);

  async function loadHeaderData() {
    try {
      await Promise.all([
        loadUser(),
        loadCompanySettings(),
      ]);
    } catch (error) {
      console.error(
        "Header data error:",
        error
      );
    }
  }

  async function loadUser() {
    try {
      const user =
        await getCurrentUser();

      if (!user) {
        setUserName("User");
        return;
      }

      const profile =
        await getCurrentUserProfile();

      setUserName(
        profile?.full_name ||
          profile?.username ||
          user.user_metadata?.full_name ||
          user.user_metadata?.username ||
          user.email ||
          "User"
      );
    } catch (error) {
      console.error(
        "Header user error:",
        error
      );

      setUserName("User");
    }
  }

  async function loadCompanySettings() {
    try {
      const data =
        await getSystemSettings();

      setCompanyName(
        data?.company_name || ""
      );

      setCompanyLogo(
        data?.company_logo_url || null
      );
    } catch (error) {
      console.error(
        "Company settings error:",
        error
      );
    }
  }

  return (
    <div
      style={{
        height: 70,
        background: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 30px",
        boxShadow:
          "0 2px 6px rgba(0,0,0,.1)",
        gap: 20,
      }}
    >
      {/* ==================================================
          LEFT SIDE - LOGO + COMPANY NAME + PAGE TITLE
      =================================================== */}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 15,
          minWidth: 0,
        }}
      >
        {/* Company Logo */}

        {companyLogo ? (
          <img
            src={companyLogo}
            alt={`${companyName || "Company"} logo`}
            style={{
              height: 48,
              width: 48,
              objectFit: "contain",
              borderRadius: 6,
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              height: 48,
              width: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#f3f4f6",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 700,
              color: "#1e3a5f",
              flexShrink: 0,
            }}
          >
            LMS
          </div>
        )}

        {/* Company Name */}

        <div
          style={{
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#1e3a5f",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {companyName}
          </div>
        </div>
      </div>

      {/* ==================================================
          RIGHT SIDE - USER
      =================================================== */}

      <strong
        style={{
          whiteSpace: "nowrap",
          color: "#374151",
        }}
      >
        {userName}
      </strong>
    </div>
  );
}