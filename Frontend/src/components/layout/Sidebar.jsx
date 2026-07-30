import { Link } from "react-router-dom";
import {
    Dashboard,
    People,
    AccountBalanceWallet,
    Payments,
    Description,
    Assessment,
    Settings,
    Logout
} from "@mui/icons-material";

const menu = [
  { text: "Dashboard", icon: <Dashboard />, path: "/dashboard" },
  { text: "Customers", icon: <People />, path: "/customers" },
  { text: "Loans", icon: <AccountBalanceWallet />, path: "/loans" },
  { text: "Repayments", icon: <Payments />, path: "/repayments" },
  { text: "Statements", icon: <Description />, path: "/statements" },
  { text: "Reports", icon: <Assessment />, path: "/reports" },
  { text: "Settings", icon: <Settings />, path: "/settings" },
  { text: "Logout", icon: <Logout />, path: "/" },
];

export default function Sidebar() {
    return (
        <div
            style={{
                width: 250,
                height: "100vh",
                background: "#0B3D91",
                color: "white",
                padding: 20
            }}
        >
            <h2>Umhlomunye Finance</h2>

            {menu.map((item) => (
            <Link
                key={item.text}
                to={item.path}
                style={{
                display: "flex",
                alignItems: "center",
                gap: "12",
                padding: "12px 16px",
                color: "white",
                textDecoration: "none",
                borderRadius: "8",
                marginBottom: "8"
            }}
            >
            {item.icon}
            <span>{item.text}</span>
            </Link>
            ))}
        </div>
    );
}