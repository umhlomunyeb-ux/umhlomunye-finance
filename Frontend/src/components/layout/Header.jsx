import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Header() {
  const [userName, setUserName] = useState("User");

  useEffect(() => {
    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function loadUser() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserName("User");
        return;
      }

      const { data: profile, error } = await supabase
        .from("users")
        .select("username, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Unable to load header user:", error);
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
      console.error("Header user error:", error);
      setUserName("User");
    }
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
        boxShadow: "0 2px 6px rgba(0,0,0,.1)",
      }}
    >
      <h2>Dashboard</h2>

      <strong>{userName}</strong>
    </div>
  );
}