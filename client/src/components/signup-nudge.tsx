import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import { X } from "lucide-react";

const KEY_COUNT = "signup_nudge_count";
const KEY_FLOWS = "signup_nudge_flows_since";
const MAX_SHOWS = 3;
const FLOWS_BETWEEN = 2;

function ss(key: string): number {
  return parseInt(sessionStorage.getItem(key) ?? "0", 10);
}

function ph(event: string, props?: Record<string, unknown>) {
  if (typeof window !== "undefined" && (window as any).posthog) {
    (window as any).posthog.capture(event, props);
  }
}

// Official Google "G" icon with brand colours
function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

interface SignUpNudgeProps {
  movieTitle?: string;
}

export function SignUpNudge({ movieTitle }: SignUpNudgeProps) {
  const { login } = useAuth();
  const [show, setShow] = useState(false);
  const scheduled = useRef(false);

  useEffect(() => {
    if (scheduled.current) return;

    const shownCount = ss(KEY_COUNT);
    const flowsSince = ss(KEY_FLOWS);
    const isFirstEver = shownCount === 0;
    const enoughFlowsSince = flowsSince >= FLOWS_BETWEEN;

    if (shownCount >= MAX_SHOWS) return;
    if (!isFirstEver && !enoughFlowsSince) return;

    scheduled.current = true;

    const t = setTimeout(() => {
      sessionStorage.setItem(KEY_COUNT, String(shownCount + 1));
      sessionStorage.setItem(KEY_FLOWS, "0");
      ph("signup_modal_shown", { trigger_source: "post_recommendation", show_number: shownCount + 1 });
      setShow(true);
    }, 2000);

    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!show) return null;

  const handleContinue = () => {
    ph("signin_modal_converted", {
      trigger_source: "post_recommendation",
      show_number: ss(KEY_COUNT),
    });
    sessionStorage.setItem("auth_trigger_source", "post_recommendation");
    login();
  };

  const handleDismiss = () => {
    ph("signup_modal_dismissed", { trigger_source: "post_recommendation" });
    sessionStorage.setItem(KEY_FLOWS, "0");
    setShow(false);
  };

  return createPortal(
    <div className="fixed inset-x-0 bottom-8 z-[9999] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-sm bg-[#1a1a1a] rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div>
            <p className="text-white font-bold text-base leading-tight">
              {movieTitle ? `Save "${movieTitle}"?` : "Save this pick?"}
            </p>
            <p className="text-white/50 text-sm mt-1 leading-snug">
              Save this and get better recommendations every time.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/25 hover:text-white/60 transition-colors ml-3 mt-0.5 shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Google button */}
        <div className="px-5 pb-4">
          <button
            onClick={handleContinue}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors rounded-lg h-11 shadow-sm"
          >
            <GoogleG />
            <span className="text-[#3c4043] font-medium text-sm tracking-wide">Continue with Google</span>
          </button>
        </div>

        {/* Later */}
        <div className="pb-4 flex justify-center">
          <button
            onClick={handleDismiss}
            className="text-white/30 hover:text-white/60 text-xs font-medium transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
