import type { RecommendationTrack } from "@shared/schema";
import { Button } from "@/components/ui/button";

interface RecommendationTrackPickerProps {
  sessionId: string;
  onSelect: (track: RecommendationTrack) => void;
}

export function RecommendationTrackPicker({ sessionId, onSelect }: RecommendationTrackPickerProps) {
  return (
    <div className="relative z-10 flex flex-col items-center gap-8 w-full max-w-md mx-auto px-4 py-10">
      <div className="text-center space-y-2">
        <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Pick your lane</h1>
        <p className="text-sm text-white/50">Same taste — different type of picks</p>
      </div>

      <div className="flex flex-col gap-4 w-full">
        <div className="rounded-xl border border-white/12 bg-black/40 overflow-hidden hover:border-primary/35 transition-colors">
          <div className="p-5">
            <h2 className="text-lg font-semibold text-white">Mainstream</h2>
            <p className="text-sm text-white/50 mt-1">Easy, high-confidence picks for tonight</p>
            <Button
              className="w-full mt-4 font-semibold bg-primary hover:bg-primary/90"
              onClick={() => {
                if (typeof window !== "undefined" && window.posthog) {
                  window.posthog.capture("recommendation_track_selected", {
                    track: "mainstream",
                    session_id: sessionId,
                  });
                }
                onSelect("mainstream");
              }}
              data-testid="track-mainstream"
            >
              Show mainstream
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-white/12 bg-black/40 overflow-hidden hover:border-primary/35 transition-colors">
          <div className="p-5">
            <h2 className="text-lg font-semibold text-white">Less obvious</h2>
            <p className="text-sm text-white/50 mt-1">Stronger, less predictable picks</p>
            <Button
              className="w-full mt-4 font-semibold bg-primary hover:bg-primary/90"
              onClick={() => {
                if (typeof window !== "undefined" && window.posthog) {
                  window.posthog.capture("recommendation_track_selected", {
                    track: "indie",
                    session_id: sessionId,
                  });
                }
                onSelect("indie");
              }}
              data-testid="track-indie"
            >
              Show something better
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
