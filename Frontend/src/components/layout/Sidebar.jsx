import {
  useEffect,
  useState,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  Dashboard,
  People,
  AccountBalanceWallet,
  Assessment,
  Settings,
  Logout,
  Assignment,
  AccountBalance,
  Description,
} from "@mui/icons-material";

import { signOut } from "../../services/authService";
import { getSystemSettings } from "../../services/settingsService";

const menu = [
  {
    text: "Dashboard",
    icon: <Dashboard />,
    path: "/dashboard",
  },
  {
    text: "Customers",
    icon: <People />,
    path: "/customers",
  },
  {
    text: "Applications",
    icon: <Assignment />,
    path: "/applications",
  },
  {
    text: "Loans",
    icon: <AccountBalanceWallet />,
    path: "/loans",
  },
  {
    text: "Documents",
    icon: <Description />,
    path: "/documents",
  },
  {
    text: "Reports",
    icon: <Assessment />,
    path: "/reports",
  },
  {
    text: "Bank",
    icon: <AccountBalance />,
    path: "/bank",
  },
  {
    text: "Settings",
    icon: <Settings />,
    path: "/settings",
  },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const [companyName, setCompanyName] =
    useState("");

  const [companyShortName, setCompanyShortName] =
    useState("");

  useEffect(() => {
    loadCompanySettings();
  }, []);

  async function loadCompanySettings() {
    try {
      const data =
        await getSystemSettings();

      const configuredCompanyName =
        String(
          data?.company_name || ""
        ).trim();

      const configuredShortName =
        String(
          data?.short_name || ""
        ).trim();

      setCompanyName(
        configuredCompanyName
      );

      setCompanyShortName(
        configuredShortName
      );
    } catch (error) {
      console.error(
        "Sidebar company settings error:",
        error
      );
    }
  }

  const handleLogout = async () => {
    try {
      const { error } =
        await signOut();

      if (error) {
        console.error(
          "LOGOUT ERROR:",
          error
        );
        return;
      }

      // Replace the protected page in browser history so
      // the user cannot return to it with the Back button.
      navigate("/", { replace: true });
    } catch (error) {
      console.error(
        "LOGOUT ERROR:",
        error
      );
    }
  };

  return (
    <aside
      style={{
        width: "250px",
        minWidth: "250px",
        height: "100vh",
        background:
          "linear-gradient(180deg, #0B3D91 0%, #082E6D 100%)",
        color: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        padding: "20px 14px",
        boxSizing: "border-box",
        overflowY: "auto",
        position: "relative",
        zIndex: 1000,
        boxShadow:
          "4px 0 18px rgba(16, 24, 40, 0.10)",
      }}
    >
      {/* BRAND */}
      <div
        style={{
          padding: "6px 10px 24px",
          borderBottom:
            "1px solid rgba(255,255,255,0.12)",
          marginBottom: "18px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "11px",
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background:
                "rgba(255,255,255,0.14)",
              border:
                "1px solid rgba(255,255,255,0.16)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <AccountBalanceWallet
              style={{
                fontSize: 24,
                color: "#FFFFFF",
              }}
            />
          </div>

          <div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
              }}
            >
              {companyName}
            </div>

            <div
              style={{
                fontSize: 12,
                color:
                  "rgba(255,255,255,0.70)",
                marginTop: 3,
                whiteSpace: "nowrap",
              }}
            >
              {companyShortName}
            </div>
          </div>
        </div>
      </div>

      {/* NAVIGATION */}
      <nav
        style={{
          flex: 1,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color:
              "rgba(255,255,255,0.45)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            padding: "0 12px 9px",
          }}
        >
          Main Menu
        </div>

        {menu.map((item) => {
          const isActive =
            location.pathname ===
              item.path ||
            (item.path !== "/dashboard" &&
              location.pathname.startsWith(
                `${item.path}/`
              ));

          return (
            <Link
              key={item.text}
              to={item.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "13px",
                minHeight: "46px",
                padding: "0 13px",
                marginBottom: "5px",
                color: isActive
                  ? "#FFFFFF"
                  : "rgba(255,255,255,0.76)",
                textDecoration: "none",
                borderRadius: "10px",
                background: isActive
                  ? "rgba(255,255,255,0.16)"
                  : "transparent",
                fontWeight:
                  isActive ? 700 : 500,
                fontSize: "14px",
                position: "relative",
                transition:
                  "background 0.18s ease, color 0.18s ease, transform 0.18s ease",
                boxSizing: "border-box",
              }}
              onMouseEnter={(event) => {
                if (!isActive) {
                  event.currentTarget.style.background =
                    "rgba(255,255,255,0.08)";
                  event.currentTarget.style.color =
                    "#FFFFFF";
                }
              }}
              onMouseLeave={(event) => {
                if (!isActive) {
                  event.currentTarget.style.background =
                    "transparent";
                  event.currentTarget.style.color =
                    "rgba(255,255,255,0.76)";
                }
              }}
            >
              {isActive && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "9px",
                    bottom: "9px",
                    width: "3px",
                    borderRadius:
                      "0 4px 4px 0",
                    background: "#FFFFFF",
                  }}
                />
              )}

              <span
                style={{
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent:
                    "center",
                  flexShrink: 0,
                  opacity:
                    isActive ? 1 : 0.82,
                }}
              >
                {item.icon}
              </span>

              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow:
                    "ellipsis",
                }}
              >
                {item.text}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* LOGOUT */}
      <div
        style={{
          borderTop:
            "1px solid rgba(255,255,255,0.12)",
          paddingTop: "14px",
          marginTop: "10px",
        }}
      >
        <button
          type="button"
          onClick={handleLogout}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "13px",
            minHeight: "46px",
            padding: "0 13px",
            color:
              "rgba(255,255,255,0.75)",
            background: "transparent",
            border: "none",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: 500,
            transition:
              "background 0.18s ease, color 0.18s ease",
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "left",
            boxSizing: "border-box",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background =
              "rgba(255,255,255,0.08)";
            event.currentTarget.style.color =
              "#FFFFFF";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background =
              "transparent";
            event.currentTarget.style.color =
              "rgba(255,255,255,0.75)";
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Logout />
          </span>

          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}