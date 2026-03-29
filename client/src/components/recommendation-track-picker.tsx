import { useState } from "react";
import type { RecommendationTrack } from "@shared/schema";

interface RecommendationTrackPickerProps {
  sessionId: string;
  onSelect: (track: RecommendationTrack) => void;
}

export function RecommendationTrackPicker({ sessionId, onSelect }: RecommendationTrackPickerProps) {
  const [selectedSide, setSelectedSide] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleSelect = (side: "left" | "right", track: RecommendationTrack) => {
    if (isAnimating) return;
    setSelectedSide(side);
    setIsAnimating(true);
    if (typeof window !== "undefined" && window.posthog) {
      window.posthog.capture("recommendation_track_selected", {
        track,
        session_id: sessionId,
      });
    }
    setTimeout(() => {
      onSelect(track);
    }, 600);
  };

  const activeSelection = selectedSide;

  const renderLaneCard = (
    side: "left" | "right",
    track: RecommendationTrack,
    topLabel: string,
    headline: string,
    supportingLine: string,
    testId: string
  ) => {
    const isWinner = activeSelection === side;
    const isLoser = activeSelection !== null && activeSelection !== side;

    return (
      <div className="relative flex flex-col items-center gap-2 flex-1 min-w-0 max-w-[180px] md:max-w-[300px]">
        <button
          type="button"
          disabled={isAnimating}
          onClick={() => handleSelect(side, track)}
          style={{
            transform: isWinner
              ? "scale(1.08) translateY(-12px)"
              : isLoser
                ? "scale(0.88) translateY(4px)"
                : "scale(1)",
          }}
          className={`
            relative w-full aspect-[2/3] rounded-lg md:rounded-xl overflow-hidden cursor-pointer text-left
            border border-white/15 bg-gradient-to-b from-white/10 via-black/50 to-black/85
            ${activeSelection !== null
              ? "transition-[transform,opacity,box-shadow] duration-500 ease-out"
              : "transition-none hover:transition-[transform,box-shadow] hover:duration-200 hover:ease-out"}
            hover:-translate-y-3 hover:scale-[1.03] hover:shadow-2xl hover:shadow-black/60 hover:border-primary/40
            ${isWinner ? "z-20 shadow-2xl shadow-primary/40 ring-2 ring-primary/60 border-primary/30" : ""}
            ${isLoser ? "z-10 opacity-40" : ""}
          `}
          data-testid={testId}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-transparent" />
          <div className="absolute inset-0 flex flex-col items-stretch justify-between p-3.5 md:p-6 pt-4 md:pt-6">
            <div className="flex flex-col gap-2 md:gap-3 min-h-0">
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.22em] text-primary/95 leading-none">
                {topLabel}
              </p>
              <p className="text-white font-bold text-base md:text-2xl leading-[1.12] tracking-tight">
                {headline}
              </p>
              <p className="text-white/58 text-[10px] md:text-[13px] leading-snug md:leading-relaxed pr-0.5">
                {supportingLine}
              </p>
            </div>
            <div
              className={`
                mt-5 md:mt-6 w-full rounded-lg md:rounded-xl py-2.5 md:py-3.5 px-2 text-center text-[11px] md:text-sm font-bold
                ${isWinner ? "bg-primary text-primary-foreground" : "bg-white/12 text-white border border-white/20"}
              `}
            >
              Show me my picks
            </div>
          </div>
          {isWinner && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-primary/90 backdrop-blur-sm rounded-full w-12 h-12 md:w-16 md:h-16 flex items-center justify-center shadow-2xl animate-bounce">
                <span className="text-xl md:text-3xl">👍</span>
              </div>
            </div>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="relative z-10 flex flex-col items-center gap-6 md:gap-8 w-full max-w-4xl mx-auto px-2 md:px-4 py-8 md:py-10">
      <div className="text-center space-y-2 px-2">
        <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Pick your lane</h1>
        <p className="text-sm text-white/50">Same taste — two very different ways we&apos;ll fill your list</p>
      </div>

      <div className="relative w-full flex flex-row gap-1 md:gap-8 items-end justify-center">
        {renderLaneCard(
          "left",
          "mainstream",
          "MAINSTREAM",
          "Blockbuster & big nights",
          "Crowd-pleasers · easy to find · streaming hits",
          "track-mainstream"
        )}

        <div className={`flex items-center justify-center shrink-0 ${activeSelection ? "opacity-0" : "opacity-100"}`}>
          <span
            className="text-3xl md:text-7xl font-black select-none"
            style={{
              fontFamily: "var(--font-display)",
              color: "#ff2d55",
              WebkitTextStroke: "2px white",
              textShadow:
                "0 0 8px rgba(255,45,85,0.9), 0 0 20px rgba(255,45,85,0.7), 0 0 40px rgba(255,45,85,0.5), 0 0 80px rgba(255,45,85,0.3)",
              letterSpacing: "0.05em",
            }}
          >
            OR
          </span>
        </div>

        {renderLaneCard(
          "right",
          "indie",
          "LEFT FIELD",
          "Lesser-known & left field",
          "Under-the-radar · festival · foreign gems",
          "track-indie"
        )}
      </div>
    </div>
  );
}
