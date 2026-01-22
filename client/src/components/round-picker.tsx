import { useState, useEffect, useRef } from "react";
import type { Movie } from "@shared/schema";
import { Loader2, Star, HelpCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RoundPickerProps {
  round: number;
  totalRounds: number;
  leftMovie: Movie;
  rightMovie: Movie;
  onChoice: (chosenMovieId: number) => void;
  onSkip?: () => void;
  isSubmitting: boolean;
  isSkipping?: boolean;
}

export function RoundPicker({
  round,
  totalRounds,
  leftMovie,
  rightMovie,
  onChoice,
  onSkip,
  isSubmitting,
  isSkipping = false,
}: RoundPickerProps) {
  const [selectedSide, setSelectedSide] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showSynopsis, setShowSynopsis] = useState<"left" | "right" | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const didShowSynopsisRef = useRef(false);

  const handleSelect = (side: "left" | "right", movieId: number) => {
    // Block selection if synopsis was shown during this press, or other blocking states
    if (isSubmitting || isAnimating || isSkipping || showSynopsis || didShowSynopsisRef.current) {
      didShowSynopsisRef.current = false;
      return;
    }
    
    setSelectedSide(side);
    setIsAnimating(true);
    
    setTimeout(() => {
      onChoice(movieId);
    }, 600);
  };

  const handleLongPressStart = (side: "left" | "right") => {
    didShowSynopsisRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      didShowSynopsisRef.current = true;
      setShowSynopsis(side);
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleCloseSynopsis = () => {
    setShowSynopsis(null);
    // Clear the ref after a brief delay so the click that closes doesn't trigger a selection
    setTimeout(() => {
      didShowSynopsisRef.current = false;
    }, 100);
  };

  useEffect(() => {
    setSelectedSide(null);
    setIsAnimating(false);
    setShowSynopsis(null);
    didShowSynopsisRef.current = false;
  }, [round, leftMovie.id, rightMovie.id]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const progress = ((round - 1) / totalRounds) * 100;

  const getPosterUrl = (movie: Movie) => {
    return movie.posterPath 
      ? movie.posterPath.startsWith("http") 
        ? movie.posterPath 
        : `https://image.tmdb.org/t/p/w500${movie.posterPath}`
      : null;
  };

  const getLeadActors = (movie: Movie) => {
    if (!movie.cast || movie.cast.length === 0) return null;
    return movie.cast.slice(0, 2).join(", ");
  };

  const isHighlyRated = (movie: Movie) => {
    return movie.rating && movie.rating >= 8.0;
  };

  const leftPosterUrl = getPosterUrl(leftMovie);
  const rightPosterUrl = getPosterUrl(rightMovie);

  const renderMovieCard = (movie: Movie, side: "left" | "right", posterUrl: string | null) => {
    const leadActors = getLeadActors(movie);
    const highlyRated = isHighlyRated(movie);

    return (
      <button
        onClick={() => handleSelect(side, movie.id)}
        onMouseDown={() => handleLongPressStart(side)}
        onMouseUp={handleLongPressEnd}
        onMouseLeave={handleLongPressEnd}
        onTouchStart={() => handleLongPressStart(side)}
        onTouchEnd={handleLongPressEnd}
        disabled={isSubmitting || isAnimating || isSkipping}
        className={`
          relative w-[42%] md:w-full max-w-[300px] aspect-[2/3] rounded-lg md:rounded-xl overflow-hidden 
          transition-all duration-500 ease-out cursor-pointer
          ${selectedSide === side 
            ? `z-20 scale-105 md:scale-110 ${side === "left" ? "md:translate-x-[60%]" : "md:-translate-x-[60%]"} shadow-2xl shadow-primary/30` 
            : selectedSide !== null 
              ? "z-10 scale-90 opacity-40" 
              : ""
          }
        `}
        data-testid={`movie-choice-${side}`}
      >
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={movie.title}
            className="w-full h-full object-cover"
            loading="eager"
          />
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <span className="text-muted-foreground text-sm md:text-lg">No Poster</span>
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        
        {/* High rating badge */}
        {highlyRated && (
          <div className="absolute top-2 left-2 md:top-3 md:left-3 flex items-center gap-1 bg-yellow-500/90 text-black px-1.5 py-0.5 md:px-2 md:py-1 rounded text-[10px] md:text-xs font-semibold">
            <Star className="w-3 h-3 fill-current" />
            <span>Acclaimed</span>
          </div>
        )}
        
        <div className="absolute bottom-0 left-0 right-0 p-2 md:p-4 text-left">
          <h3 className="text-white font-bold text-sm md:text-xl line-clamp-2">
            {movie.title}
          </h3>
          <p className="text-white/70 text-xs md:text-sm">
            {movie.year} {movie.rating ? `• ${movie.rating.toFixed(1)}★` : ""}
          </p>
          {leadActors && (
            <p className="text-white/60 text-[10px] md:text-xs mt-0.5 line-clamp-1">
              {leadActors}
            </p>
          )}
          <p className="text-white/50 text-[10px] md:text-xs mt-0.5 line-clamp-1 hidden md:block">
            {movie.genres.slice(0, 3).join(" • ")}
          </p>
        </div>
        
        {selectedSide === side && (
          <div className="absolute top-2 right-2 md:top-4 md:right-4 w-7 h-7 md:w-10 md:h-10 rounded-full bg-primary flex items-center justify-center animate-pulse">
            <svg className="w-4 h-4 md:w-6 md:h-6 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </button>
    );
  };

  const synopsisMovie = showSynopsis === "left" ? leftMovie : showSynopsis === "right" ? rightMovie : null;

  return (
    <div className="flex flex-col items-center gap-3 md:gap-6 w-full max-w-4xl mx-auto px-2 md:px-4">
      {/* Synopsis overlay */}
      {synopsisMovie && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={handleCloseSynopsis}
        >
          <div 
            className="bg-card rounded-lg p-4 md:p-6 max-w-md w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg md:text-xl font-bold text-foreground">{synopsisMovie.title}</h3>
              <button 
                onClick={handleCloseSynopsis}
                className="text-muted-foreground"
                data-testid="button-close-synopsis"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-muted-foreground text-sm mb-3">
              {synopsisMovie.year} • {synopsisMovie.rating?.toFixed(1)}★ • {synopsisMovie.runtime ? `${synopsisMovie.runtime} min` : ""}
            </p>
            <p className="text-foreground text-sm md:text-base mb-4">
              {synopsisMovie.overview || "No synopsis available."}
            </p>
            {synopsisMovie.cast && synopsisMovie.cast.length > 0 && (
              <div className="mb-3">
                <p className="text-muted-foreground text-xs mb-1">Starring</p>
                <p className="text-foreground text-sm">{synopsisMovie.cast.slice(0, 3).join(", ")}</p>
              </div>
            )}
            {synopsisMovie.director && (
              <div className="mb-3">
                <p className="text-muted-foreground text-xs mb-1">Director</p>
                <p className="text-foreground text-sm">{synopsisMovie.director}</p>
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              Tap outside to close
            </p>
          </div>
        </div>
      )}

      {/* Compact header for mobile */}
      <div className="text-center">
        <h2 className="text-lg md:text-3xl font-bold text-foreground mb-1">
          Round {round} of {totalRounds}
        </h2>
        <p className="text-muted-foreground text-xs md:text-base">Tap the movie you'd rather watch</p>
        <p className="text-muted-foreground/60 text-[10px] md:text-xs mt-1 italic hidden md:block">
          Hold on a poster for more info
        </p>
      </div>

      {/* Thinner progress bar on mobile */}
      <div className="w-full max-w-md h-1.5 md:h-2 bg-muted/30 rounded-full overflow-hidden">
        <div 
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
          data-testid="progress-bar"
        />
      </div>

      {(isSubmitting || isSkipping) && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs md:text-sm">{isSkipping ? "Getting new movies..." : "Loading next round..."}</span>
        </div>
      )}

      {/* Side-by-side on mobile, larger on desktop */}
      <div className="relative flex flex-row gap-1 md:gap-8 w-full items-center justify-center perspective-1000">
        {renderMovieCard(leftMovie, "left", leftPosterUrl)}

        {/* VS indicator - smaller on mobile, hidden during animation */}
        <div className={`flex items-center justify-center transition-opacity duration-300 ${selectedSide ? "opacity-0" : "opacity-100"}`}>
          <span className="text-lg md:text-4xl font-bold text-muted-foreground/30">VS</span>
        </div>

        {renderMovieCard(rightMovie, "right", rightPosterUrl)}
      </div>

      {/* Skip button and helper text */}
      {onSkip && !selectedSide && (
        <div className="flex flex-col items-center gap-2 mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSkip}
            disabled={isSubmitting || isAnimating || isSkipping}
            className="text-muted-foreground text-xs md:text-sm"
            data-testid="button-skip-round"
          >
            <HelpCircle className="w-4 h-4 mr-1" />
            Don't know either? Skip (+1 round)
          </Button>
          <p className="text-muted-foreground/50 text-[10px] md:text-xs text-center max-w-xs">
            A picture is worth a thousand words — go with your gut!
          </p>
        </div>
      )}
    </div>
  );
}
