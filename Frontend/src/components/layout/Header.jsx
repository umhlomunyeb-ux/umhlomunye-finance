import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Header() {
  const [userName, setUserName] = useState("User");
  const [companyName, setCompanyName] = useState(
    "Umhlomunye Finance"
  );
  const [companyLogo, setCompanyLogo] = useState(null);

  useEffect(() => {
    loadHeaderData();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadHeaderData();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function loadHeaderData() {
    try {
      await Promise.all([
        loadUser(),
        loadCompanySettings(),
      ]);
    } catch (error) {
      console.error(
        "Header data error:",
        error
      );
    }
  }

  async function loadUser() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserName("User");
        return;
      }

      const {
        data: profile,
        error,
      } = await supabase
        .from("users")
        .select("username, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Unable to load header user:",
          error
        );

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
      console.error(
        "Header user error:",
        error
      );

      setUserName("User");
    }
  }

  async function loadCompanySettings() {
    try {
      const {
        data,
        error,
      } = await supabase
        .from("system_settings")
        .select(
          "company_name, company_logo_url"
        )
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(
          "Unable to load company settings:",
          error
        );

        return;
      }

      setCompanyName(
        data?.company_name ||
          "Umhlomunye Finance"
      );

      setCompanyLogo(
        data?.company_logo_url || null
      );
    } catch (error) {
      console.error(
        "Company settings error:",
        error
      );
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
        boxShadow:
          "0 2px 6px rgba(0,0,0,.1)",
        gap: 20,
      }}
    >
      {/* ==================================================
          LEFT SIDE - LOGO + COMPANY NAME + PAGE TITLE
      =================================================== */}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 15,
          minWidth: 0,
        }}
      >
        {/* Company Logo */}

        {companyLogo ? (
          <img
            src={companyLogo}
            alt={`${companyName} logo`}
            style={{
              height: 48,
              width: 48,
              objectFit: "contain",
              borderRadius: 6,
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              height: 48,
              width: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#f3f4f6",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 700,
              color: "#1e3a5f",
              flexShrink: 0,
            }}
          >
            UBS
          </div>
        )}

        {/* Company Name */}

        <div
          style={{
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#1e3a5f",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {companyName}
          </div>
          
        </div>
      </div>


      {/* ==================================================
          RIGHT SIDE - USER
      =================================================== */}

      <strong
        style={{
          whiteSpace: "nowrap",
          color: "#374151",
        }}
      >
        {userName}
      </strong>
    </div>
  );
}