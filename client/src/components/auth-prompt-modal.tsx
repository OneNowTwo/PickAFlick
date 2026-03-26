import { Bookmark, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

interface AuthPromptModalProps {
  onSkip: () => void;
  heading?: string;
}

export function AuthPromptModal({ onSkip, heading = "Save your picks & build your taste profile" }: AuthPromptModalProps) {
  const { login } = useAuth();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-sm bg-black/90 border border-white/10 rounded-lg p-7 flex flex-col gap-6">

        <div>
          <h2 className="text-xl font-bold text-white leading-snug">
            {heading}
          </h2>
        </div>

        <ul className="space-y-3">
          <li className="flex items-start gap-3 text-white/80 text-sm">
            <Bookmark className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
            Save movies to your watchlist
          </li>
          <li className="flex items-start gap-3 text-white/80 text-sm">
            <Sparkles className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
            Get smarter recommendations every session
          </li>
          <li className="flex items-start gap-3 text-white/80 text-sm">
            <RotateCcw className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
            Pick up where you left off
          </li>
        </ul>

        <div className="flex flex-col items-center gap-3">
          <Button
            className="w-full font-semibold"
            onClick={login}
          >
            Continue with Google
          </Button>
          <button
            onClick={onSkip}
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
