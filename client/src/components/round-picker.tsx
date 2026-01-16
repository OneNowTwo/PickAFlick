import { useState } from "react";
import type { Movie } from "@shared/schema";
import { MovieChoiceCard } from "./movie-choice-card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface RoundPickerProps {
  round: number;
  totalRounds: number;
  leftMovie: Movie;
  rightMovie: Movie;
  onChoice: (chosenMovieId: number) => void;
  isSubmitting: boolean;
}

export function RoundPicker({
  round,
  totalRounds,
  leftMovie,
  rightMovie,
  onChoice,
  isSubmitting,
}: RoundPickerProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const handleSelect = (movieId: number) => {
    if (isSubmitting) return;
    setSelectedId(movieId);
  };

  const handleConfirm = () => {
    if (selectedId !== null && !isSubmitting) {
      onChoice(selectedId);
      setSelectedId(null);
    }
  };

  const progress = ((round - 1) / totalRounds) * 100;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-4xl mx-auto px-4">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
          Round {round} of {totalRounds}
        </h2>
        <p className="text-muted-foreground">Pick the movie you'd rather watch</p>
      </div>

      <div className="w-full max-w-md h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
          data-testid="progress-bar"
        />
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-8 w-full items-center justify-center">
        <div className="w-full max-w-[280px] md:max-w-[320px]">
          <MovieChoiceCard
            movie={leftMovie}
            onSelect={() => handleSelect(leftMovie.id)}
            isSelected={selectedId === leftMovie.id}
            side="left"
          />
        </div>

        <div className="flex items-center justify-center">
          <span className="text-3xl md:text-4xl font-bold text-muted-foreground/50">VS</span>
        </div>

        <div className="w-full max-w-[280px] md:max-w-[320px]">
          <MovieChoiceCard
            movie={rightMovie}
            onSelect={() => handleSelect(rightMovie.id)}
            isSelected={selectedId === rightMovie.id}
            side="right"
          />
        </div>
      </div>

      <Button
        size="lg"
        onClick={handleConfirm}
        disabled={selectedId === null || isSubmitting}
        className="min-w-[200px] text-lg py-6"
        data-testid="button-confirm"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Submitting...
          </>
        ) : (
          "Confirm Choice"
        )}
      </Button>
    </div>
  );
}
