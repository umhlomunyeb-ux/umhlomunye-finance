import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Login from "./pages/Login/Login";
import Dashboard from "./pages/Dashboard/Dashboard";
import Customers from "./pages/Customers/Customers";
import Loans from "./pages/Loans/Loans";
import Repayments from "./pages/Repayments/Repayments";
import Statements from "./pages/Statements/Statements";
import Reports from "./pages/Reports/Reports";
import Settings from "./pages/Settings/Settings";
import Documents from "./pages/Documents/Documents";
import LoanProfile from "./pages/Loans/LoanProfile";
import ProtectedRoute from "./routes/ProtectedRoute";
import MainLayout from "./components/layout/MainLayout";
import PublicApplication from "./pages/PublicApplication/PublicApplication";
import Applications from "./pages/Applications/Applications";
import ApplicationReview from "./pages/Applications/ApplicationReview";
import CustomerProfile from "./pages/Customers/CustomerProfile";
import { Toaster } from "react-hot-toast";
import SignAgreement from "./pages/Public/SignAgreement";
import VerifyStatement from "./pages/Public/VerifyStatement";
import VerifyAgreement from "./pages/Public/VerifyAgreement";
import Bank from "./pages/Bank/Bank";
const InvestorFunding = lazy(() => import("./pages/Investors/InvestorFunding"));
import TestEmail from "./pages/TestEmail";
import PendingApplications from "./pages/Applications/PendingApplications";
import MobileApplicationReviews from "./pages/Applications/MobileApplicationReviews";
import MobileApplicationReview from "./pages/Applications/MobileApplicationReview";
import MobileLanding from "./mobile/pages/MobileLanding";
import MobilePreview from "./mobile/pages/MobilePreview";
import MobileLogin from "./mobile/pages/MobileLogin";
import MobileFundingRequests from "./mobile/pages/MobileFundingRequests";
import MobileAdminRoute from "./routes/MobileAdminRoute";


export default function App() {
  return (
    <>
      <Toaster position="top-right" />

      <BrowserRouter>
        <Routes>
          {/* PUBLIC */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/apply" element={<PublicApplication />} />

          <Route
            path="/sign-agreement/:token"
            element={<SignAgreement />}
          />

          <Route
            path="/sign-agreement/offline/:agreementId"
            element={<SignAgreement />}
          />

          <Route
            path="/verify-statement/:token"
            element={<VerifyStatement />}
          />

          <Route
            path="/verify-agreement/:token"
            element={<VerifyAgreement />}
          />

                      <Route 
              path="/mobile" 
              element={<MobileLanding />} 
            />

            <Route path="/mobile/login" element={<MobileLogin />} />
            <Route path="/mobile/preview" element={<ProtectedRoute><MobileAdminRoute><MobilePreview /></MobileAdminRoute></ProtectedRoute>} />
            <Route path="/mobile/funding-requests" element={<ProtectedRoute><MobileAdminRoute><MobileFundingRequests /></MobileAdminRoute></ProtectedRoute>} />

          {/* MOBILE APPLICATION REVIEW - WEB */}
          <Route
            path="/mobile/application-review"
            element={
              <ProtectedRoute>
                <MobileAdminRoute><MobileApplicationReviews /></MobileAdminRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/mobile/application-review/:id"
            element={
              <ProtectedRoute>
                <MobileAdminRoute><MobileApplicationReview /></MobileAdminRoute>
              </ProtectedRoute>
            }
          />

          {/* DESKTOP PROTECTED SYSTEM */}
          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route
              path="/dashboard"
              element={<Dashboard />}
            />

            <Route
              path="/customers"
              element={<Customers />}
            />

            <Route
              path="/customers/:id"
              element={<CustomerProfile />}
            />

            <Route
              path="/loans"
              element={<Loans />}
            />

            <Route
              path="/repayments"
              element={<Repayments />}
            />

            <Route
              path="/statements"
              element={<Statements />}
            />

            <Route
              path="/reports"
              element={<Reports />}
            />

            <Route
              path="/settings"
              element={<Settings />}
            />

            <Route
              path="/documents"
              element={<Documents />}
            />

            <Route
              path="/applications"
              element={<Applications />}
            />

            <Route
              path="/applications/:id"
              element={<ApplicationReview />}
            />

            <Route
              path="/loans/:id"
              element={<LoanProfile />}
            />

            <Route
              path="/bank"
              element={<Bank />}
            />

            <Route
              path="/investors"
              element={<Suspense fallback={<div>Loading investor funding...</div>}><InvestorFunding /></Suspense>}
            />

            <Route
              path="/test-email"
              element={<TestEmail />}
            />

            <Route
              path="/pending-applications"
              element={<PendingApplications />}
            />

          </Route>
        </Routes>
      </BrowserRouter>
    </>
  );
}
