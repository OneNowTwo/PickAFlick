import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Bookmark, X } from "lucide-react";

function ph(event: string, props?: Record<string, unknown>) {
  if (typeof window !== "undefined" && (window as any).posthog) {
    (window as any).posthog.capture(event, props);
  }
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path fill="white" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="white" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="white" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="white" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

interface SignUpNudgeProps {
  movieTitle?: string;
}

export function SignUpNudge({ movieTitle }: SignUpNudgeProps) {
  const { login } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    ph("signup_modal_shown", { trigger_source: "post_recommendation" });
    const t = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  return createPortal(
    <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-[#111] border-t border-white/10 shadow-2xl">
      <div className="max-w-lg mx-auto px-4 pt-4 pb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-white font-bold text-sm leading-tight">
                {movieTitle ? `Save "${movieTitle}"?` : "Keep your picks?"}
              </p>
              <p className="text-white/50 text-xs mt-0.5">
                Sign in free — get better recommendations every time.
              </p>
            </div>
          </div>
          <button
            onClick={() => { ph("signup_modal_dismissed", { trigger_source: "post_recommendation" }); setShow(false); }}
            className="text-white/30 hover:text-white/60 transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { ph("signup_cta_clicked", { trigger_source: "post_recommendation" }); sessionStorage.setItem("auth_trigger_source", "post_recommendation"); login(); }}
            className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all rounded-xl h-11 text-white font-bold text-sm"
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <button
            onClick={() => { ph("signup_modal_dismissed", { trigger_source: "post_recommendation" }); setShow(false); }}
            className="px-4 h-11 rounded-xl border border-white/10 text-white/40 hover:text-white/70 text-sm font-medium transition-colors"
          >
            Later
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
