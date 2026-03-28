import type { RecommendationTrack, TastePreview } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface RecommendationTrackPickerProps {
  sessionId: string;
  taste: TastePreview | undefined;
  tasteLoading: boolean;
  onSelect: (track: RecommendationTrack) => void;
}

const OPTIONS: { id: RecommendationTrack; title: string; description: string }[] = [
  {
    id: "mainstream",
    title: "Mainstream",
    description:
      "Well-known, easy-to-find picks tonight — polished, high-confidence watches that still match your funnel.",
  },
  {
    id: "indie",
    title: "Indie & less obvious",
    description:
      "Acclaimed smaller films, strong indies, and distinctive voices — same taste profile, less familiar titles.",
  },
];

export function RecommendationTrackPicker({
  sessionId,
  taste,
  tasteLoading,
  onSelect,
}: RecommendationTrackPickerProps) {
  return (
    <div className="relative z-10 flex flex-col items-center gap-8 w-full max-w-lg mx-auto px-4 py-10">
      <div className="text-center space-y-3">
        <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
          Mainstream or indie?
        </h1>
        <p className="text-sm text-white/55">Same taste read — different reach. Pick one row.</p>
      </div>

      <div
        className="w-full rounded-2xl border border-white/10 bg-black/50 backdrop-blur-md p-5 md:p-6 space-y-4"
        data-testid="taste-preview-card"
      >
        {tasteLoading ? (
          <div className="flex items-center justify-center gap-3 py-8 text-white/60">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Reading your picks…</span>
          </div>
        ) : taste ? (
          <>
            <p className="text-base md:text-lg font-medium text-white leading-snug text-center">
              {taste.headline}
            </p>
            <p className="text-sm text-white/65 leading-relaxed text-center">{taste.patternSummary}</p>
          </>
        ) : (
          <p className="text-sm text-white/50 text-center py-4">Couldn&apos;t load your taste summary — you can still choose a row.</p>
        )}
      </div>

      <div className="flex flex-col gap-4 w-full">
        {OPTIONS.map((opt) => (
          <div
            key={opt.id}
            className="rounded-xl border border-white/12 bg-black/40 overflow-hidden hover:border-primary/40 transition-colors"
          >
            <div className="p-4 md:p-5">
              <h2 className="text-lg font-semibold text-white">{opt.title}</h2>
              <p className="text-sm text-white/55 mt-1 leading-relaxed">{opt.description}</p>
              <Button
                className="w-full mt-4 font-semibold bg-primary hover:bg-primary/90"
                onClick={() => {
                  if (typeof window !== "undefined" && window.posthog) {
                    window.posthog.capture("recommendation_track_selected", {
                      track: opt.id,
                      session_id: sessionId,
                    });
                  }
                  onSelect(opt.id);
                }}
                data-testid={`track-${opt.id}`}
              >
                Show me {opt.title.toLowerCase()} picks
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
