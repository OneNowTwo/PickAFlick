import { createContext, useContext, useEffect, useState, useCallback } from "react";

/** Prevents duplicate user_signed_in from React Strict Mode / overlapping effects (cleared on logout). */
const PH_AUTH_SIGNIN_CAPTURED_KEY = "ph_auth_signin_captured";

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
    const params = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

    const isFreshLogin = params.get("auth_success") === "1";
    const isNewUser = isFreshLogin && params.get("new_user") === "1";

    fetch("/auth/me")
      .then((r) => r.json())
      .then((data) => {
        const resolvedUser = data.user ?? null;
        setUser(resolvedUser);
        if (isFreshLogin && resolvedUser) {
          const ph = (window as any).posthog;
          if (ph) {
            const triggerSource = sessionStorage.getItem("auth_trigger_source") || "unknown";
            sessionStorage.removeItem("auth_trigger_source");

            let shouldCaptureSignin = true;
            try {
              if (sessionStorage.getItem(PH_AUTH_SIGNIN_CAPTURED_KEY) === "1") {
                shouldCaptureSignin = false;
              } else {
                sessionStorage.setItem(PH_AUTH_SIGNIN_CAPTURED_KEY, "1");
              }
            } catch {
              shouldCaptureSignin = true;
            }

            const identifyProps: Record<string, string> = {
              email: resolvedUser.email,
              name: resolvedUser.displayName,
              username: resolvedUser.email,
            };
            if (isNewUser) {
              identifyProps.signup_date = new Date().toISOString();
              identifyProps.first_trigger_source = triggerSource;
            }

            ph.identify(String(resolvedUser.id), identifyProps);

            if (shouldCaptureSignin) {
              ph.capture("user_signed_in", {
                method: "google",
                trigger_source: triggerSource,
                is_new_user: isNewUser,
              });
            }
          }
          // Clean the query params without a page reload
          const url = new URL(window.location.href);
          url.searchParams.delete("auth_success");
          url.searchParams.delete("new_user");
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
    try {
      sessionStorage.removeItem(PH_AUTH_SIGNIN_CAPTURED_KEY);
    } catch {
      /* ignore */
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
