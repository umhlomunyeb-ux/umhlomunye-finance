import { Link, useLocation } from "react-router-dom";

import {
  Dashboard,
  People,
  AccountBalanceWallet,
  Payments,
  Description,
  Assessment,
  Settings,
  Logout,
  Assignment,
  AccountBalance,
} from "@mui/icons-material";

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
    text: "Repayments",
    icon: <Payments />,
    path: "/repayments",
  },
  {
    text: "Statements",
    icon: <Description />,
    path: "/statements",
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
        boxShadow: "4px 0 18px rgba(16, 24, 40, 0.10)",
      }}
    >
      {/* BRAND */}
      <div
        style={{
          padding: "6px 10px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
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
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.16)",
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
              Umhlomunye
            </div>

            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.70)",
                marginTop: 3,
                whiteSpace: "nowrap",
              }}
            >
              Finance
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
            color: "rgba(255,255,255,0.45)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            padding: "0 12px 9px",
          }}
        >
          Main Menu
        </div>

        {menu.map((item) => {
          const isActive =
            location.pathname === item.path ||
            (item.path !== "/dashboard" &&
              location.pathname.startsWith(`${item.path}/`));

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
                fontWeight: isActive ? 700 : 500,
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
                  event.currentTarget.style.color = "#FFFFFF";
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
                    borderRadius: "0 4px 4px 0",
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
                  justifyContent: "center",
                  flexShrink: 0,
                  opacity: isActive ? 1 : 0.82,
                }}
              >
                {item.icon}
              </span>

              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
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
          borderTop: "1px solid rgba(255,255,255,0.12)",
          paddingTop: "14px",
          marginTop: "10px",
        }}
      >
        <Link
          to="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "13px",
            minHeight: "46px",
            padding: "0 13px",
            color: "rgba(255,255,255,0.75)",
            textDecoration: "none",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: 500,
            transition: "background 0.18s ease",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background =
              "rgba(255,255,255,0.08)";
            event.currentTarget.style.color = "#FFFFFF";
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
        </Link>
      </div>
    </aside>
  );
}