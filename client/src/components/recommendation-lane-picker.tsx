import type { RecommendationLane } from "@shared/schema";
import { cn } from "@/lib/utils";

const LANES: {
  id: RecommendationLane;
  tag: string;
  tagVariant: "muted" | "recommended" | "dark";
  title: string;
  description: string;
  recommended?: boolean;
  bgClass: string;
}[] = [
  {
    id: "mainstream",
    tag: "ENTRY LEVEL",
    tagVariant: "muted",
    title: "MAINSTREAM",
    description:
      "First-pass accessible picks — the default “good tonight” row. Perfect for effortless entertainment and popcorn classics.",
    bgClass:
      "bg-gradient-to-br from-slate-800/90 via-zinc-950/95 to-black bg-[length:100%_100%]",
  },
  {
    id: "movie_buff",
    tag: "RECOMMENDED",
    tagVariant: "recommended",
    title: "MOVIE BUFF",
    description:
      "Not the same cloth — less obvious & more curated, still your A/B taste. For the viewer who knows their directors.",
    recommended: true,
    bgClass:
      "bg-gradient-to-br from-amber-950/35 via-zinc-900/90 to-black",
  },
  {
    id: "left_field",
    tag: "AVANT-GARDE",
    tagVariant: "dark",
    title: "LEFT FIELD",
    description:
      "Go deep — international & arthouse energy, still your funnel. Uncover obscure masterpieces and bold cinema.",
    bgClass:
      "bg-gradient-to-b from-black via-zinc-950 to-black",
  },
];

interface RecommendationLanePickerProps {
  sessionId: string;
  onSelect: (lane: RecommendationLane) => void;
}

export function RecommendationLanePicker({ sessionId, onSelect }: RecommendationLanePickerProps) {
  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 py-8 md:py-14">
      <header className="text-center mb-8 md:mb-12">
        <h2 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-wide text-white drop-shadow-sm">
          Pick your{" "}
          <span className="text-primary">lane.</span>
        </h2>
        <p className="mt-3 text-sm md:text-base text-white/50 font-sans font-normal tracking-normal max-w-md mx-auto">
          Select your level of cinematic depth.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
        {LANES.map((lane) => (
          <button
            key={lane.id}
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.posthog) {
                window.posthog.capture("recommendation_lane_selected", {
                  lane: lane.id,
                  session_id: sessionId,
                });
              }
              onSelect(lane.id);
            }}
            data-testid={`lane-${lane.id}`}
            className={cn(
              "group relative flex flex-col min-h-[300px] md:min-h-[380px] rounded-2xl overflow-hidden text-left border transition-all duration-300",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              lane.recommended
                ? "border-primary/80 shadow-[0_0_28px_rgba(220,38,38,0.28)] md:scale-[1.02] z-[1]"
                : "border-white/10 hover:border-white/20 hover:shadow-lg hover:shadow-black/40"
            )}
          >
            {/* Moody backdrop + readability */}
            <div
              className={cn(
                "absolute inset-0 transition-transform duration-500 group-hover:scale-105",
                lane.bgClass
              )}
            />
            <div
              className="absolute inset-0 opacity-[0.35] mix-blend-overlay"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />

            <div className="relative z-10 flex flex-col flex-1 p-5 md:p-6">
              <span
                className={cn(
                  "inline-flex self-start px-2.5 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-widest border",
                  lane.tagVariant === "recommended" &&
                    "bg-primary/20 text-primary border-primary/40",
                  lane.tagVariant === "muted" &&
                    "bg-black/55 text-white/85 border-white/10",
                  lane.tagVariant === "dark" &&
                    "bg-black/55 text-white/75 border-white/10"
                )}
              >
                {lane.tag}
              </span>

              <h3 className="mt-5 text-2xl md:text-3xl font-black uppercase tracking-[0.12em] text-white">
                {lane.title}
              </h3>

              <p className="mt-3 text-sm md:text-[15px] leading-relaxed text-white/70 font-sans font-normal tracking-normal flex-1">
                {lane.description}
              </p>

              <span
                className={cn(
                  "mt-6 w-full py-3 rounded-lg text-center text-xs font-bold uppercase tracking-[0.2em] transition-colors",
                  lane.recommended
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30 group-hover:bg-primary/90"
                    : "bg-white/10 text-white border border-white/10 group-hover:bg-white/15"
                )}
              >
                Select lane
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
