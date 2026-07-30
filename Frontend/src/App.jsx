import { BrowserRouter, Routes, Route } from "react-router-dom";

import Login from "./pages/Login/Login";
import Dashboard from "./pages/Dashboard/Dashboard";
import Customers from "./pages/Customers/Customers";
import Loans from "./pages/Loans/Loans";
import Repayments from "./pages/Repayments/Repayments";
import Statements from "./pages/Statements/Statements";
import Reports from "./pages/Reports/Reports";
import Settings from "./pages/Settings/Settings";
import LoanProfile from "./pages/Loans/LoanProfile";
import ProtectedRoute from "./routes/ProtectedRoute";
import MainLayout from "./components/layout/MainLayout";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Login />} />

        {/* Protected */}
        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/repayments" element={<Repayments />} />
          <Route path="/statements" element={<Statements />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/loans/:id" element={<LoanProfile />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}