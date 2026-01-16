import { X, Heart, RefreshCw } from "lucide-react";

interface SwipeControlsProps {
  onPass: () => void;
  onLike: () => void;
  onShuffle: () => void;
  disabled?: boolean;
  isShuffling?: boolean;
}

export function SwipeControls({ onPass, onLike, onShuffle, disabled, isShuffling }: SwipeControlsProps) {
  return (
    <div className="flex items-center justify-center gap-8">
      <button
        onClick={onPass}
        disabled={disabled}
        className="flex items-center justify-center w-16 h-16 rounded-full border-2 border-red-500/50 bg-transparent hover-elevate active-elevate-2 transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none"
        data-testid="button-pass"
      >
        <X className="w-8 h-8 text-red-500" />
      </button>

      <button
        onClick={onShuffle}
        disabled={isShuffling}
        className="flex items-center justify-center w-12 h-12 rounded-full border border-border bg-transparent hover-elevate active-elevate-2 transition-colors duration-200 disabled:opacity-50"
        data-testid="button-shuffle"
      >
        <RefreshCw className={`w-5 h-5 text-muted-foreground ${isShuffling ? "animate-spin" : ""}`} />
      </button>

      <button
        onClick={onLike}
        disabled={disabled}
        className="flex items-center justify-center w-16 h-16 rounded-full border-2 border-green-500/50 bg-transparent hover-elevate active-elevate-2 transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none"
        data-testid="button-like"
      >
        <Heart className="w-8 h-8 text-green-500" />
      </button>
    </div>
  );
}
