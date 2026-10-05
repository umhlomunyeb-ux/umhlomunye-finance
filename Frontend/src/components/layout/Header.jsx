import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import NotificationsNoneOutlinedIcon from "@mui/icons-material/NotificationsNoneOutlined";

import { supabase } from "../../lib/supabase";

export default function Header() {
  const navigate = useNavigate();

  const [userName, setUserName] = useState("User");
  const [companyName, setCompanyName] = useState("Company");
  const [companyLogo, setCompanyLogo] = useState(null);
  const [pendingApplications, setPendingApplications] =
    useState(0);

  useEffect(() => {
    loadHeaderData();
    loadPendingApplications();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadHeaderData();
      loadPendingApplications();
    });

    const channel = supabase
      .channel("header-pending-applications")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loan_applications",
        },
        () => {
          loadPendingApplications();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
      supabase.removeChannel(channel);
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

  async function loadPendingApplications() {
    try {
      const { count, error } = await supabase
        .from("loan_applications")
        .select("id", {
          count: "exact",
          head: true,
        })
        .in("status", ["PENDING", "UNDER_REVIEW"]);

      if (error) {
        console.error(
          "Unable to load pending applications:",
          error
        );
        return;
      }

      setPendingApplications(count || 0);
    } catch (error) {
      console.error(
        "Pending applications error:",
        error
      );
    }
  }

  async function loadUser() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserName("User");
        return;
      }

      const {
        data: profile,
        error,
      } = await supabase
        .from("users")
        .select("username, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Unable to load header user:",
          error
        );

        setUserName(
          user.user_metadata?.full_name ||
            user.user_metadata?.username ||
            user.email ||
            "User"
        );

        return;
      }

      setUserName(
        profile?.full_name ||
          profile?.username ||
          user.user_metadata?.full_name ||
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
      const {
        data,
        error,
      } = await supabase
        .from("system_settings")
        .select(
          "company_name, company_logo_url"
        )
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(
          "Unable to load company settings:",
          error
        );

        return;
      }

      setCompanyName(
        data?.company_name || "Company"
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

  function handleNotifications() {
    navigate("/applications");
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
      {/* LEFT SIDE - LOGO + COMPANY NAME */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 15,
          minWidth: 0,
        }}
      >
        {companyLogo ? (
          <img
            src={companyLogo}
            alt={`${companyName} logo`}
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
            APP
          </div>
        )}

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

      {/* RIGHT SIDE - NOTIFICATIONS + USER */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <button
          type="button"
          onClick={handleNotifications}
          aria-label={
            pendingApplications > 0
              ? `${pendingApplications} applications require attention`
              : "Notifications"
          }
          style={{
            position: "relative",
            width: 42,
            height: 42,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
          }}
        >
          <NotificationsNoneOutlinedIcon
            style={{
              fontSize: 27,
              color: "#374151",
            }}
          />

          {pendingApplications > 0 && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 20,
                height: 20,
                padding: "0 5px",
                borderRadius: 10,
                background: "#dc2626",
                color: "white",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
              }}
            >
              {pendingApplications > 99
                ? "99+"
                : pendingApplications}
            </span>
          )}
        </button>

        <strong
          style={{
            whiteSpace: "nowrap",
            color: "#374151",
          }}
        >
          {userName}
        </strong>
      </div>
    </div>
  );
}
