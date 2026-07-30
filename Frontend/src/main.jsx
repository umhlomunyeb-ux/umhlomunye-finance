import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";

ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <App />

    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3000,
      }}
    />
  </AuthProvider>
);
