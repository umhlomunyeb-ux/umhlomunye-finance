import { createContext, useEffect, useState } from "react";

import {
  getCurrentUser,
  onAuthStateChange,
} from "../services/authService";

export const AuthContext = createContext({
  user: null,
  loading: true,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const currentUser =
          await getCurrentUser();

        if (!mounted) return;

        setUser(
          currentUser ?? null
        );
      } catch (error) {
        console.error(
          "AUTH INITIALIZATION ERROR:",
          error
        );

        if (mounted) {
          setUser(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initializeAuth();

    const {
      data: { subscription },
    } = onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;

        setUser(
          session?.user ?? null
        );

        setLoading(false);
      }
    );

    return () => {
      mounted = false;

      subscription?.unsubscribe?.();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}