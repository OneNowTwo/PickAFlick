import { createContext, useContext, useEffect, useState, useCallback } from "react";

interface AuthUser {
  id: number;
  googleId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const isFreshLogin = typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("auth_success") === "1";

    fetch("/auth/me")
      .then((r) => r.json())
      .then((data) => {
        const resolvedUser = data.user ?? null;
        setUser(resolvedUser);
        if (isFreshLogin && resolvedUser) {
          if ((window as any).posthog) {
            (window as any).posthog.identify(String(resolvedUser.id), {
              email: resolvedUser.email,
              name: resolvedUser.displayName,
              username: resolvedUser.email,
            });
            (window as any).posthog.capture("user_signed_in", { method: "google" });
          }
          // Clean the query param without a page reload
          const url = new URL(window.location.href);
          url.searchParams.delete("auth_success");
          window.history.replaceState({}, "", url.toString());
        }
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(() => {
    window.location.href = "/auth/google";
  }, []);

  const logout = useCallback(async () => {
    if (typeof window !== "undefined" && (window as any).posthog) {
      (window as any).posthog.capture("user_signed_out");
    }
    await fetch("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
