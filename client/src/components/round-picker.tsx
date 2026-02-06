import { useState, useEffect, useRef } from "react";
import type { Movie, ChoiceHistory } from "@shared/schema";
import { Loader2, Star, Shuffle, X, Brain, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface RoundPickerProps {
  round: number;
  totalRounds: number;
  baseTotalRounds: number; // Original total before skips
  choicesMade: number; // Actual choices made
  leftMovie: Movie;
  rightMovie: Movie;
  onChoice: (chosenMovieId: number) => void;
  onSkip?: () => void;
  isSubmitting: boolean;
  isSkipping?: boolean;
  choiceHistory?: ChoiceHistory[];
  selectedGenres?: string[]; // Genre filters for display
}

// Generate personalized insight based on choices made
function generateInsight(choiceHistory: ChoiceHistory[], round: number): string {
  if (!choiceHistory || choiceHistory.length === 0) {
    return "Pick the poster that calls to you...";
  }

  const chosenMovies = choiceHistory.map(c => c.chosenMovie);
  
  // Analyze patterns
  const genreCounts: Record<string, number> = {};
  const eraCounts: Record<string, number> = {};
  let highRatingCount = 0;
  let actorNames: string[] = [];
  
  chosenMovies.forEach(movie => {
    movie.genres.forEach(g => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
    
    if (movie.year) {
      if (movie.year >= 2015) eraCounts["recent"] = (eraCounts["recent"] || 0) + 1;
      else if (movie.year >= 2000) eraCounts["2000s"] = (eraCounts["2000s"] || 0) + 1;
      else eraCounts["classic"] = (eraCounts["classic"] || 0) + 1;
    }
    
    if (movie.rating && movie.rating >= 7.5) highRatingCount++;
    
    if (movie.cast && movie.cast[0]) {
      actorNames.push(movie.cast[0]);
    }
  });

  const topGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g);
  
  const topEra = Object.entries(eraCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  // Generate varied insights based on round and patterns
  const insights: string[] = [];
  
  if (round === 2 && topGenres.length > 0) {
    insights.push(`Interesting... ${topGenres[0]} vibes detected!`);
    insights.push(`I sense some ${topGenres[0]} energy tonight...`);
  }
  
  if (round === 3 && topGenres.length >= 2) {
    insights.push(`${topGenres[0]} meets ${topGenres[1]} — intriguing taste!`);
    insights.push(`You like ${topGenres[0]} with a ${topGenres[1]} twist...`);
  }
  
  if (round === 4 && highRatingCount >= 2) {
    insights.push("You've got an eye for the critically acclaimed!");
    insights.push("Quality over quantity — I like it!");
  } else if (round === 4) {
    insights.push("Building your taste profile...");
    insights.push("Keep going, almost there!");
  }
  
  if (round === 5 && topEra === "recent") {
    insights.push("Fresh films are your thing — got it!");
    insights.push("Modern cinema lover detected!");
  } else if (round === 5 && topEra === "classic") {
    insights.push("A classic film buff — respect!");
    insights.push("Old school vibes coming through!");
  } else if (round === 5) {
    insights.push("Your preferences are coming together...");
  }
  
  if (round >= 6 && actorNames.length > 0) {
    const uniqueActors = Array.from(new Set(actorNames));
    if (uniqueActors.length > 0) {
      insights.push(`Maybe a ${uniqueActors[0]} fan? Almost there!`);
      insights.push("Final stretch — I think I know what you want!");
    }
  }
  
  if (round >= 6) {
    insights.push("Just a bit more and I'll have your picks ready!");
    insights.push("The picture is almost complete...");
  }

  // Pick a random insight from available ones, or use a default
  if (insights.length > 0) {
    return insights[Math.floor(Math.random() * insights.length)];
  }
  
  const defaults = [
    "Learning your taste...",
    "Keep picking!",
    "Trust your instincts!",
  ];
  return defaults[round % defaults.length];
}

// Get fun status message based on progress
function getProgressMessage(progress: number, round: number): string {
  if (progress === 0) return "Let's go!";
  if (progress < 30) return "Getting started...";
  if (progress < 50) return "I see what you like...";
  if (progress < 70) return "Building your profile...";
  if (progress < 85) return "Nearly there!";
  if (progress < 100) return "Almost got it!";
  return "Done!";
}

// Progress ring component with percentage and status
function ProgressRing({ progress, round, size = 90 }: { progress: number; round: number; size?: number }) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  const statusMessage = getProgressMessage(progress, round);
  
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="transform -rotate-90" width={size} height={size}>
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            className="text-muted/30"
          />
          {/* Progress ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            className="text-primary transition-all duration-700 ease-out"
            style={{
              strokeDasharray: circumference,
              strokeDashoffset,
            }}
          />
        </svg>
        {/* Center content - percentage and icon */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Brain className={`w-5 h-5 text-primary ${progress > 0 ? "animate-pulse" : ""}`} />
          <span className="text-xs font-bold text-primary mt-0.5">{Math.round(progress)}%</span>
        </div>
      </div>
      {/* Status message below ring */}
      <span className="text-xs text-muted-foreground font-medium animate-pulse">
        {statusMessage}
      </span>
    </div>
  );
}

export function RoundPicker({
  round,
  totalRounds,
  baseTotalRounds,
  choicesMade,
  leftMovie,
  rightMovie,
  onChoice,
  onSkip,
  isSubmitting,
  isSkipping = false,
  choiceHistory = [],
  selectedGenres = []
}: RoundPickerProps) {
  const [selectedSide, setSelectedSide] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showSynopsis, setShowSynopsis] = useState<"left" | "right" | null>(null);
  const [insight, setInsight] = useState("");
  const [addedToWatchlist, setAddedToWatchlist] = useState<Set<number>>(new Set());
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const didShowSynopsisRef = useRef(false);
  
  // Swipe gesture state
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);

  const addToWatchlistMutation = useMutation({
    mutationFn: async (movie: Movie) => {
      return await apiRequest("POST", "/api/watchlist", {
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.year,
        posterPath: movie.posterPath,
        genres: movie.genres,
        rating: movie.rating,
      });
    },
    onSuccess: (_data, movie) => {
      setAddedToWatchlist(prev => new Set(prev).add(movie.tmdbId));
    },
  });

  const handleSelect = (side: "left" | "right", movieId: number) => {
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
    setTimeout(() => {
      didShowSynopsisRef.current = false;
    }, 100);
  };
  
  // Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isSubmitting || isAnimating || isSkipping) return;
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };
  
  const handleTouchMove = (e: React.TouchEvent) => {
    if (isSubmitting || isAnimating || isSkipping || touchStart === null) return;
    const currentTouch = e.targetTouches[0].clientX;
    setTouchEnd(currentTouch);
    // Visual feedback during swipe
    const offset = currentTouch - touchStart;
    setSwipeOffset(offset);
  };
  
  const handleTouchEnd = () => {
    if (isSubmitting || isAnimating || isSkipping || !touchStart || !touchEnd) {
      setSwipeOffset(0);
      return;
    }
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50; // Swipe left = select left movie
    const isRightSwipe = distance < -50; // Swipe right = select right movie
    
    if (isLeftSwipe) {
      handleSelect("left", leftMovie.id);
    } else if (isRightSwipe) {
      handleSelect("right", rightMovie.id);
    }
    
    setTouchStart(null);
    setTouchEnd(null);
    setSwipeOffset(0);
  };
  
  // Tap on title to show synopsis (instead of long-press)
  const handleTitleTap = (side: "left" | "right", e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSynopsis(side);
  };

  // Generate new insight when round changes
  useEffect(() => {
    setSelectedSide(null);
    setIsAnimating(false);
    setShowSynopsis(null);
    didShowSynopsisRef.current = false;
    setInsight(generateInsight(choiceHistory, round));
  }, [round, leftMovie.id, rightMovie.id, choiceHistory]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // Calculate progress based on actual choices made vs base total rounds
  // This way, skipping doesn't move the progress bar backwards
  const progress = (choicesMade / baseTotalRounds) * 100;

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
    const isAdded = addedToWatchlist.has(movie.tmdbId);

    const handleAddToWatchlist = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isAdded) {
        addToWatchlistMutation.mutate(movie);
      }
    };

    return (
      <button
        onClick={() => handleSelect(side, movie.id)}
        disabled={isSubmitting || isAnimating || isSkipping}
        className={`
          relative w-[42%] md:w-full max-w-[300px] aspect-[2/3] rounded-lg md:rounded-xl overflow-hidden 
          transition-all duration-500 ease-out cursor-pointer
          hover:-translate-y-2 hover:shadow-xl
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
        
        {highlyRated && (
          <div className="absolute top-2 left-2 md:top-3 md:left-3 flex items-center gap-1 bg-yellow-500/90 text-black px-1.5 py-0.5 md:px-2 md:py-1 rounded text-[10px] md:text-xs font-semibold">
            <Star className="w-3 h-3 fill-current" />
            <span>Acclaimed</span>
          </div>
        )}
        
        {/* Add to Watchlist button */}
        <button
          onClick={handleAddToWatchlist}
          disabled={isAdded}
          className={`absolute top-2 right-2 md:top-3 md:right-3 flex items-center gap-1 px-2 py-1 rounded text-[10px] md:text-xs font-semibold transition-all ${
            isAdded 
              ? "bg-green-600 text-white" 
              : "bg-black/60 text-white/90 hover:bg-black/80 hover:text-white"
          }`}
          data-testid={`button-add-watchlist-${side}`}
        >
          <Bookmark className={`w-3 h-3 ${isAdded ? "fill-current" : ""}`} />
          <span>{isAdded ? "Added!" : "Save"}</span>
        </button>
        
        <div className="absolute bottom-0 left-0 right-0 p-2 md:p-4 text-left">
          <h3 
            onClick={(e) => handleTitleTap(side, e)}
            className="text-white font-bold text-sm md:text-xl line-clamp-2 cursor-pointer hover:text-primary transition-colors"
          >
            {movie.title}
          </h3>
          <p className="text-white/70 text-xs md:text-sm pointer-events-none">
            {movie.year} {movie.rating ? `• ${movie.rating.toFixed(1)}★` : ""}
          </p>
          {leadActors && (
            <p className="text-white/60 text-[10px] md:text-xs mt-0.5 line-clamp-1 pointer-events-none">
              {leadActors}
            </p>
          )}
          <p className="text-white/50 text-[10px] md:text-xs mt-0.5 line-clamp-1 hidden md:block pointer-events-none">
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
    <div className="flex flex-col items-center gap-2 md:gap-4 w-full max-w-4xl mx-auto px-2 md:px-4">
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

      {/* Progress ring and insight header */}
      <div className="flex flex-col items-center gap-3">
        <ProgressRing progress={progress} round={round} size={80} />

        <p className="text-muted-foreground text-xs md:text-sm max-w-xs text-center">
          {insight}
        </p>
      </div>

      {(isSubmitting || isSkipping) && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs md:text-sm">{isSkipping ? "Getting new movies..." : "Loading next round..."}</span>
        </div>
      )}

      {/* Side-by-side movie cards with swipe support */}
      <div 
        className="relative flex flex-row gap-1 md:gap-8 w-full items-start justify-center perspective-1000 touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: swipeOffset !== 0 ? `translateX(${swipeOffset * 0.3}px)` : 'none',
          transition: swipeOffset === 0 ? 'transform 0.2s ease-out' : 'none'
        }}
      >
        {renderMovieCard(leftMovie, "left", leftPosterUrl)}

        <div className={`flex items-center justify-center transition-opacity duration-300 ${selectedSide ? "opacity-0" : "opacity-100"}`}>
          <span className="text-3xl md:text-6xl font-black text-primary/90 drop-shadow-lg">VS</span>
        </div>

        {renderMovieCard(rightMovie, "right", rightPosterUrl)}
      </div>

      {/* Skip button - bold and prominent */}
      {onSkip && !selectedSide && (
        <Button
          variant="secondary"
          size="default"
          onClick={onSkip}
          disabled={isSubmitting || isAnimating || isSkipping}
          className="mt-2 font-semibold"
          data-testid="button-skip-round"
        >
          <Shuffle className="w-4 h-4 mr-2" />
          Skip & Get New Pair (+1 round)
        </Button>
      )}

      {/* Swipe hint - mobile only */}
      <p className="text-muted-foreground/40 text-[10px] text-center md:hidden">
        Swipe left/right or tap • Tap title for details
      </p>
    </div>
  );
}
