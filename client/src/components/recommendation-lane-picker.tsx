import type { RecommendationLane } from "@shared/schema";
import { Button } from "@/components/ui/button";

const LANES: { id: RecommendationLane; label: string; hint: string }[] = [
  {
    id: "mainstream",
    label: "Mainstream",
    hint: "First-pass accessible picks — the default “good tonight” row.",
  },
  {
    id: "movie_buff",
    label: "Movie Buff",
    hint: "Not the same cloth — less obvious & more curated, still your A/B taste.",
  },
  {
    id: "left_field",
    label: "Left Field",
    hint: "Go deep — international & arthouse energy, still your funnel.",
  },
];

interface RecommendationLanePickerProps {
  sessionId: string;
  onSelect: (lane: RecommendationLane) => void;
}

export function RecommendationLanePicker({ sessionId, onSelect }: RecommendationLanePickerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-8 px-4 py-12 max-w-lg mx-auto text-center">
      <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Pick your lane.</h2>
      <div className="flex flex-col gap-3 w-full">
        {LANES.map(({ id, label, hint }) => (
          <Button
            key={id}
            type="button"
            size="lg"
            className="h-auto min-h-[3.5rem] flex-col gap-1 py-4 px-6 text-left sm:text-center w-full border border-white/15 bg-white/5 hover:bg-white/10 hover:border-primary/40 transition-colors"
            onClick={() => {
              if (typeof window !== "undefined" && window.posthog) {
                window.posthog.capture("recommendation_lane_selected", {
                  lane: id,
                  session_id: sessionId,
                });
              }
              onSelect(id);
            }}
            data-testid={`lane-${id}`}
          >
            <span className="text-base font-semibold text-white">{label}</span>
            <span className="text-xs font-normal text-white/55 leading-snug">{hint}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
