import { useContext, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import Login from "../pages/Login/Login";
import ProtectedRoute from "../routes/ProtectedRoute";
import MobileApplicationReviews from "../pages/Applications/MobileApplicationReviews";
import MobileApplicationReview from "../pages/Applications/MobileApplicationReview";

import MobileLanding from "./pages/MobileLanding";
import MobilePreview from "./pages/MobilePreview";

import { AuthContext } from "../context/AuthContext";
import { initializePushNotifications } from "./pushNotifications";

function MobilePushInitializer() {
  const { user } = useContext(AuthContext);
  const cleanupRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const setupPushNotifications = async () => {
      if (!user?.id) {
        return;
      }

      if (cleanupRef.current) {
        await cleanupRef.current();
        cleanupRef.current = null;
      }

      const cleanup = await initializePushNotifications(user);

      if (cancelled) {
        if (cleanup) {
          await cleanup();
        }

        return;
      }

      cleanupRef.current = cleanup;
    };

    setupPushNotifications();

    return () => {
      cancelled = true;

      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [user?.id]);

  return null;
}

export default function MobileApp() {
  return (
    <>
      <Toaster position="top-right" />

      <BrowserRouter>
        <MobilePushInitializer />

        <Routes>
          {/* MOBILE APP STARTUP / PAIRING */}
          <Route
            path="/"
            element={<Navigate to="/mobile" replace />}
          />

          {/* MOBILE PAIRING - PUBLIC */}
          <Route
            path="/mobile"
            element={<MobileLanding />}
          />

          {/* MOBILE PREVIEW - TEMPORARY */}
          <Route
            path="/mobile/preview"
            element={<MobilePreview />}
          />

          {/* MOBILE LOGIN */}
          <Route
            path="/login"
            element={<Login />}
          />

          {/* MOBILE PENDING APPLICATIONS - PROTECTED */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <MobileApplicationReviews />
              </ProtectedRoute>
            }
          />

          {/* MOBILE APPLICATION REVIEW - PROTECTED */}
          <Route
            path="/mobile/application-review/:id"
            element={
              <ProtectedRoute>
                <MobileApplicationReview />
              </ProtectedRoute>
            }
          />

          {/* MOBILE APPLICATION REVIEW LIST - PROTECTED */}
          <Route
            path="/mobile/application-review"
            element={
              <ProtectedRoute>
                <MobileApplicationReviews />
              </ProtectedRoute>
            }
          />

          {/* FALLBACK */}
          <Route
            path="*"
            element={<Navigate to="/mobile" replace />}
          />
        </Routes>
      </BrowserRouter>
    </>
  );
}
