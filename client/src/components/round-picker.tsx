import { useState, useEffect } from "react";
import type { Movie } from "@shared/schema";
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
  const [selectedSide, setSelectedSide] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleSelect = (side: "left" | "right", movieId: number) => {
    if (isSubmitting || isAnimating) return;
    
    setSelectedSide(side);
    setIsAnimating(true);
    
    // Delay before submitting to show the animation
    setTimeout(() => {
      onChoice(movieId);
    }, 600);
  };

  // Reset animation state when round changes
  useEffect(() => {
    setSelectedSide(null);
    setIsAnimating(false);
  }, [round, leftMovie.id, rightMovie.id]);

  const progress = ((round - 1) / totalRounds) * 100;

  const getPosterUrl = (movie: Movie) => {
    return movie.posterPath 
      ? movie.posterPath.startsWith("http") 
        ? movie.posterPath 
        : `https://image.tmdb.org/t/p/w500${movie.posterPath}`
      : null;
  };

  const leftPosterUrl = getPosterUrl(leftMovie);
  const rightPosterUrl = getPosterUrl(rightMovie);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-4xl mx-auto px-4">
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
          Round {round} of {totalRounds}
        </h2>
        <p className="text-muted-foreground">Tap the movie you'd rather watch</p>
      </div>

      <div className="w-full max-w-md h-2 bg-muted/30 rounded-full overflow-hidden">
        <div 
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
          data-testid="progress-bar"
        />
      </div>

      {isSubmitting && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading next round...</span>
        </div>
      )}

      <div className="relative flex flex-col md:flex-row gap-4 md:gap-8 w-full items-center justify-center perspective-1000">
        {/* Left Movie */}
        <button
          onClick={() => handleSelect("left", leftMovie.id)}
          disabled={isSubmitting || isAnimating}
          className={`
            relative w-full max-w-[280px] md:max-w-[300px] aspect-[2/3] rounded-xl overflow-hidden 
            transition-all duration-500 ease-out cursor-pointer
            ${selectedSide === "left" 
              ? "z-20 scale-110 md:translate-x-[60%] shadow-2xl shadow-primary/30" 
              : selectedSide === "right" 
                ? "z-10 scale-90 opacity-40 -translate-x-4" 
                : "hover:scale-[1.02] hover:shadow-xl hover:shadow-black/50"
            }
          `}
          data-testid="movie-choice-left"
        >
          {leftPosterUrl ? (
            <img
              src={leftPosterUrl}
              alt={leftMovie.title}
              className="w-full h-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground text-lg">No Poster</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 text-left">
            <h3 className="text-white font-bold text-lg md:text-xl line-clamp-2">
              {leftMovie.title}
            </h3>
            <p className="text-white/70 text-sm">
              {leftMovie.year} {leftMovie.rating ? `• ${leftMovie.rating.toFixed(1)}★` : ""}
            </p>
            {leftMovie.genres.length > 0 && (
              <p className="text-white/60 text-xs mt-1 line-clamp-1">
                {leftMovie.genres.slice(0, 3).join(" • ")}
              </p>
            )}
          </div>
          {selectedSide === "left" && (
            <div className="absolute top-4 right-4 w-10 h-10 rounded-full bg-primary flex items-center justify-center animate-pulse">
              <svg className="w-6 h-6 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>

        {/* VS indicator - hidden during animation */}
        <div className={`flex items-center justify-center transition-opacity duration-300 ${selectedSide ? "opacity-0" : "opacity-100"}`}>
          <span className="text-3xl md:text-4xl font-bold text-muted-foreground/30">VS</span>
        </div>

        {/* Right Movie */}
        <button
          onClick={() => handleSelect("right", rightMovie.id)}
          disabled={isSubmitting || isAnimating}
          className={`
            relative w-full max-w-[280px] md:max-w-[300px] aspect-[2/3] rounded-xl overflow-hidden 
            transition-all duration-500 ease-out cursor-pointer
            ${selectedSide === "right" 
              ? "z-20 scale-110 md:-translate-x-[60%] shadow-2xl shadow-primary/30" 
              : selectedSide === "left" 
                ? "z-10 scale-90 opacity-40 translate-x-4" 
                : "hover:scale-[1.02] hover:shadow-xl hover:shadow-black/50"
            }
          `}
          data-testid="movie-choice-right"
        >
          {rightPosterUrl ? (
            <img
              src={rightPosterUrl}
              alt={rightMovie.title}
              className="w-full h-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground text-lg">No Poster</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 text-left">
            <h3 className="text-white font-bold text-lg md:text-xl line-clamp-2">
              {rightMovie.title}
            </h3>
            <p className="text-white/70 text-sm">
              {rightMovie.year} {rightMovie.rating ? `• ${rightMovie.rating.toFixed(1)}★` : ""}
            </p>
            {rightMovie.genres.length > 0 && (
              <p className="text-white/60 text-xs mt-1 line-clamp-1">
                {rightMovie.genres.slice(0, 3).join(" • ")}
              </p>
            )}
          </div>
          {selectedSide === "right" && (
            <div className="absolute top-4 right-4 w-10 h-10 rounded-full bg-primary flex items-center justify-center animate-pulse">
              <svg className="w-6 h-6 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
