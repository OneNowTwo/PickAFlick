import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

interface AuthPromptModalProps {
  onSkip: () => void;
  heading?: string;
  triggerSource?: string;
}

const AVATARS = [
  "https://i.pravatar.cc/64?img=11",
  "https://i.pravatar.cc/64?img=32",
  "https://i.pravatar.cc/64?img=57",
];

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

function ph(event: string, props?: Record<string, unknown>) {
  if (typeof window !== "undefined" && (window as any).posthog) {
    (window as any).posthog.capture(event, props);
  }
}

export function AuthPromptModal({
  onSkip,
  heading = "Save your picks & build your taste profile",
  triggerSource = "unknown",
}: AuthPromptModalProps) {
  const { login } = useAuth();

  useEffect(() => {
    ph("signup_modal_shown", { trigger_source: triggerSource });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContinue = () => {
    ph("signup_cta_clicked", { trigger_source: triggerSource });
    sessionStorage.setItem("auth_trigger_source", triggerSource);
    login();
  };

  const handleSkip = () => {
    ph("signup_modal_dismissed", { trigger_source: triggerSource });
    onSkip();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm p-4 gap-6">

      {/* Card */}
      <div className="w-full max-w-md bg-[#111] rounded-2xl p-8 flex flex-col items-center gap-5 shadow-2xl">

        {/* Headline */}
        <div className="text-center flex flex-col gap-2">
          <h2 className="text-4xl font-black text-white tracking-tight uppercase leading-none">
            Welcome Back
          </h2>
          <p className="text-white/60 text-base font-medium">
            {heading}
          </p>
        </div>

        {/* Google button */}
        <button
          onClick={handleContinue}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors rounded-xl h-14 shadow-md mt-1"
        >
          <GoogleG />
          <span className="text-[#3c4043] font-semibold text-base">Continue with Google</span>
        </button>

        {/* Skip */}
        <button
          onClick={handleSkip}
          className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 hover:text-white/60 transition-colors"
        >
          Skip for now
        </button>
      </div>

      {/* Social proof — below the card */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center">
          {AVATARS.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              className="w-9 h-9 rounded-full border-2 border-[#111] object-cover"
              style={{ marginLeft: i === 0 ? 0 : "-10px", zIndex: AVATARS.length - i }}
            />
          ))}
          <div
            className="w-9 h-9 rounded-full border-2 border-[#111] bg-white/10 flex items-center justify-center text-white text-[11px] font-bold"
            style={{ marginLeft: "-10px" }}
          >
            +43k
          </div>
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40 text-center">
          Join 43,000+ Australians who've stopped scrolling.
        </p>
      </div>

    </div>
  );
}
