import { useNavigate, useLocation } from "react-router-dom";
import { Paper, BottomNavigation, BottomNavigationAction } from "@mui/material";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";

export default function MobileBottomNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const value = location.pathname.startsWith("/mobile/funding-requests") ? "funding"
    : location.pathname.startsWith("/mobile/application-review") ? "applications" : "home";
  return (
    <Paper elevation={8} sx={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, borderTop: "1px solid", borderColor: "divider" }}>
      <BottomNavigation value={value} onChange={(_, next) => {
        if (next === "home") navigate("/mobile/preview");
        if (next === "applications") navigate("/mobile/application-review");
        if (next === "funding") navigate("/mobile/funding-requests");
      }} showLabels sx={{ height: 62 }}>
        <BottomNavigationAction label="Dashboard" value="home" icon={<HomeOutlinedIcon />} />
        <BottomNavigationAction label="Applications" value="applications" icon={<DescriptionOutlinedIcon />} />
        <BottomNavigationAction label="Funding" value="funding" icon={<AccountBalanceWalletOutlinedIcon />} />
      </BottomNavigation>
    </Paper>
  );
}
