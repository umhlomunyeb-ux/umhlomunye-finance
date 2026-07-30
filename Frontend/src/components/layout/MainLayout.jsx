import Sidebar from "./Sidebar";
import Header from "./Header";
import { Outlet } from "react-router-dom";

export default function MainLayout() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#f4f6f9",
      }}
    >
      <Sidebar />

      <div style={{ flex: 1 }}>
        <Header />

        <main style={{ padding: 30 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}