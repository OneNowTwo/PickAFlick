import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Fragment } from "react";
import type { Movie, ChoiceHistory } from "@shared/schema";
import { Loader2, Star, Shuffle, X, Brain, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { AuthPromptModal } from "./auth-prompt-modal";

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
    return "Choose the movie that feels right for tonight so we can figure out what you're in the mood for.";
  }

  const last = choiceHistory[choiceHistory.length - 1];
  const chosenMovies = choiceHistory.map(c => c.chosenMovie);

  // Derive patterns from choices
  const genreCounts: Record<string, number> = {};
  const eraCounts: Record<string, number> = {};
  let highRatingCount = 0;

  chosenMovies.forEach(movie => {
    (movie.genres || []).forEach(g => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
    if (movie.year) {
      if (movie.year >= 2015) eraCounts["recent"] = (eraCounts["recent"] || 0) + 1;
      else if (movie.year >= 2000) eraCounts["2000s"] = (eraCounts["2000s"] || 0) + 1;
      else eraCounts["classic"] = (eraCounts["classic"] || 0) + 1;
    }
    if (movie.rating && movie.rating >= 7.5) highRatingCount++;
  });

  const topGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g);

  const topEra = Object.entries(eraCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  const chosenTitle = last?.chosenMovie?.title;
  const rejectedTitle = last?.rejectedMovie?.title;
  const chosenGenre = last?.chosenMovie?.genres?.[0];
  const rejectedGenre = last?.rejectedMovie?.genres?.[0];
  const chosenYear = last?.chosenMovie?.year;

  const insights: string[] = [];

  // Round 2 — first real signal
  if (round === 2) {
    if (chosenTitle && rejectedTitle) {
      insights.push(`You picked "${chosenTitle}" over "${rejectedTitle}" — noted.`);
      insights.push(`"${chosenTitle}" it is. I'm already building a picture...`);
    }
    if (chosenGenre) {
      insights.push(`${chosenGenre} energy in round one — let's see if that holds...`);
    }
  }

  // Round 3 — pattern starting to form
  if (round === 3) {
    if (chosenTitle && rejectedGenre && chosenGenre && chosenGenre !== rejectedGenre) {
      insights.push(`You're leaning ${chosenGenre} over ${rejectedGenre} — that's useful.`);
    } else if (topGenres.length >= 2) {
      insights.push(`${topGenres[0]} with a side of ${topGenres[1]}? Interesting combo.`);
    } else if (chosenTitle) {
      insights.push(`"${chosenTitle}" again confirms the direction — good signal.`);
    }
  }

  // Round 4 — tone and quality signals
  if (round === 4) {
    if (highRatingCount >= 2) {
      insights.push("You keep picking the better-rated film. Good taste — makes my job easier.");
      insights.push("You've got a strong sense of quality. I'm matching that.");
    } else if (chosenTitle && rejectedTitle) {
      insights.push(`"${chosenTitle}" over "${rejectedTitle}" — the tone is coming through.`);
    } else if (topGenres[0]) {
      insights.push(`Consistent ${topGenres[0]} lean across 3 rounds. I'm locking that in.`);
    }
  }

  // Round 5 — era and style solidifying
  if (round === 5) {
    if (topEra === "recent" && chosenYear && chosenYear >= 2015) {
      insights.push("You like it fresh — modern releases are clearly your thing.");
      insights.push(`${chosenYear}? You're drawn to recent cinema. Got it.`);
    } else if (topEra === "classic") {
      insights.push("A pattern: you keep picking older films. Classic taste — I respect it.");
      insights.push("You're not chasing new releases. Noted — the classics are on the table.");
    } else if (chosenTitle) {
      insights.push(`"${chosenTitle}" keeps fitting the profile I'm building. Almost there.`);
    } else {
      insights.push("Halfway through — your taste profile is taking real shape now.");
    }
  }

  // Round 6 — penultimate, specific
  if (round === 6) {
    if (chosenTitle && rejectedTitle) {
      insights.push(`"${chosenTitle}" over "${rejectedTitle}" — picture's getting clearer.`);
      insights.push(`You chose "${chosenTitle}" — that's the strongest signal yet.`);
    } else if (topGenres[0]) {
      insights.push(`${topGenres[0]} is dominant across your choices. One more to confirm.`);
    } else {
      insights.push("Second-to-last round. The profile is almost locked in.");
    }
  }

  // Round 7 — final round, user hasn't chosen yet
  if (round >= 7) {
    if (topGenres[0] && chosenTitle) {
      insights.push(`Last one. "${chosenTitle}" summed up the ${topGenres[0]} lean — now seal it.`);
      insights.push(`Final round. I've got plenty to work with — this just sharpens it.`);
    } else {
      insights.push("Last round. Pick what feels right and I'll do the rest.");
      insights.push("Final pick. I think I already know — just confirm it.");
    }
  }

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
  const { user } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedSide, setSelectedSide] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  /** Only apply winner/loser transforms for the pair that was actually clicked */
  const [selectionPair, setSelectionPair] = useState<{ left: number; right: number } | null>(null);
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
        posterPath: movie.posterPath,
        releaseYear: movie.year,
        genres: movie.genres,
      });
    },
    onSuccess: (_data, movie) => {
      setAddedToWatchlist(prev => new Set(prev).add(movie.tmdbId));
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      if (typeof window !== "undefined" && (window as any).posthog) {
        (window as any).posthog.capture("watchlist_saved", {
          tmdb_id: movie.tmdbId,
          title: movie.title,
          genres: movie.genres,
          source: "round_picker",
        });
      }
    },
    onError: (_err, movie) => {
      // Remove optimistic state if save failed
      setAddedToWatchlist(prev => {
        const next = new Set(prev);
        next.delete(movie.tmdbId);
        return next;
      });
    },
  });

  const handleSelect = (side: "left" | "right", movieId: number) => {
    if (isSubmitting || isAnimating || isSkipping || showSynopsis || didShowSynopsisRef.current) {
      didShowSynopsisRef.current = false;
      return;
    }
    
    setSelectedSide(side);
    setIsAnimating(true);
    setSelectionPair({ left: leftMovie.id, right: rightMovie.id });

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

  // Reset pick animation only when the actual pair changes (not when choiceHistory updates alone)
  useEffect(() => {
    setSelectedSide(null);
    setIsAnimating(false);
    setSelectionPair(null);
    setShowSynopsis(null);
    didShowSynopsisRef.current = false;
    setSwipeOffset(0);
  }, [round, leftMovie.id, rightMovie.id]);

  useEffect(() => {
    setInsight(generateInsight(choiceHistory, round));
  }, [choiceHistory, round]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // Calculate progress based on current round (not choices made)
  // Progress shows rounds COMPLETED, so round 7 shows 6/7 = 86%, then completes after choice
  const progress = ((round - 1) / baseTotalRounds) * 100;

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

  /** Hide poster row until images decode (or timeout) so layout never flashes empty/wrong frames */
  const posterLoadsNeeded = useMemo(
    () => (leftPosterUrl ? 1 : 0) + (rightPosterUrl ? 1 : 0),
    [leftPosterUrl, rightPosterUrl]
  );
  const posterLoadsDone = useRef(0);
  const [postersVisible, setPostersVisible] = useState(false);

  useLayoutEffect(() => {
    posterLoadsDone.current = 0;
    if (posterLoadsNeeded === 0) setPostersVisible(true);
    else setPostersVisible(false);
  }, [leftMovie.id, rightMovie.id, round, posterLoadsNeeded]);

  useEffect(() => {
    if (posterLoadsNeeded === 0) return;
    const t = window.setTimeout(() => setPostersVisible(true), 550);
    return () => window.clearTimeout(t);
  }, [leftMovie.id, rightMovie.id, round, posterLoadsNeeded]);

  const onPosterLoad = useCallback(() => {
    posterLoadsDone.current += 1;
    if (posterLoadsDone.current >= posterLoadsNeeded) setPostersVisible(true);
  }, [posterLoadsNeeded]);

  // Synchronous: never treat stale selectedSide as active after pair changes (fixes 1-frame glitch)
  const pairMatchesSelection =
    selectionPair !== null &&
    selectionPair.left === leftMovie.id &&
    selectionPair.right === rightMovie.id;
  const activeSelection = pairMatchesSelection ? selectedSide : null;

  const renderMovieCard = (
    movie: Movie,
    side: "left" | "right",
    posterUrl: string | null,
    onPosterDecode?: () => void
  ) => {
    const leadActors = getLeadActors(movie);
    const highlyRated = isHighlyRated(movie);
    const isAdded = addedToWatchlist.has(movie.tmdbId);
    const isWinner = activeSelection === side;
    const isLoser = activeSelection !== null && activeSelection !== side;

    const handleAddToWatchlist = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!user) {
        setShowAuthModal(true);
        return;
      }
      if (!isAdded) {
        addToWatchlistMutation.mutate(movie);
      }
    };

    return (
      <div key={`${movie.id}-${round}`} className="relative flex flex-col items-center gap-2">
        {/* Main poster button */}
        <button
          onClick={() => handleSelect(side, movie.id)}
          disabled={isSubmitting || isAnimating || isSkipping}
          style={{
            transform: isWinner
              ? "scale(1.08) translateY(-12px)"
              : isLoser
                ? "scale(0.88) translateY(4px)"
                : "scale(1)",
          }}
          className={`
            relative w-full max-w-[180px] md:max-w-[300px] aspect-[2/3] rounded-lg md:rounded-xl overflow-hidden
            cursor-pointer
            ${activeSelection !== null
              ? "transition-[transform,opacity,box-shadow] duration-500 ease-out"
              : "transition-none hover:transition-[transform,box-shadow] hover:duration-200 hover:ease-out"}
            hover:-translate-y-3 hover:scale-[1.03] hover:shadow-2xl hover:shadow-black/60
            ${isWinner ? "z-20 shadow-2xl shadow-primary/40 ring-2 ring-primary/60" : ""}
            ${isLoser ? "z-10 opacity-40" : ""}
          `}
          data-testid={`movie-choice-${side}`}
        >
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={movie.title}
              className="w-full h-full object-cover"
              loading="eager"
              onLoad={onPosterDecode}
            />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground text-sm md:text-lg">No Poster</span>
            </div>
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

          {/* Acclaimed badge */}
          {highlyRated && (
            <div className="absolute top-2 left-2 md:top-3 md:left-3 flex items-center gap-1 bg-yellow-500/90 text-black px-1.5 py-0.5 md:px-2 md:py-1 rounded text-[10px] md:text-xs font-semibold">
              <Star className="w-3 h-3 fill-current" />
              <span>Acclaimed</span>
            </div>
          )}

          {/* Movie info bottom */}
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

          {/* Winner thumbs up — centre of card */}
          {isWinner && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-primary/90 backdrop-blur-sm rounded-full w-14 h-14 md:w-20 md:h-20 flex items-center justify-center shadow-2xl animate-bounce">
                <span className="text-2xl md:text-4xl">👍</span>
              </div>
            </div>
          )}

          {/* Loser overlay — "Save for later?" clickable nudge */}
          {isLoser && !isAdded && (
            <button
              onClick={handleAddToWatchlist}
              className="absolute inset-0 flex items-center justify-center pointer-events-auto"
            >
              <div className="bg-black/75 backdrop-blur-sm border border-white/30 rounded-full px-4 py-2 flex items-center gap-2">
                <Bookmark className="w-3.5 h-3.5 text-white" />
                <span className="text-white text-[11px] md:text-xs font-bold">Save for later?</span>
              </div>
            </button>
          )}
        </button>

        {/* Add to Watchlist button — sits below poster, never covers titles */}
        <button
          onClick={handleAddToWatchlist}
          disabled={isAdded}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] md:text-xs font-semibold transition-all duration-200 backdrop-blur-md border
            ${isAdded
              ? "bg-green-600/90 border-green-500/60 text-white scale-105"
              : "bg-black/50 border-white/20 text-white/70 hover:bg-black/80 hover:border-white/50 hover:text-white hover:scale-105 active:scale-95"
            }`}
          data-testid={`button-add-watchlist-${side}`}
        >
          <Bookmark className={`w-3 h-3 shrink-0 ${isAdded ? "fill-current" : ""}`} />
          <span>{isAdded ? "Added ✓" : "Add to Watchlist"}</span>
        </button>
      </div>
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

        <p className="text-white text-sm md:text-base font-medium max-w-md text-center tracking-wide px-2">
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
      <div className="relative w-full">
        {!postersVisible && !isSubmitting && !isSkipping && (
          <div className="absolute inset-x-0 top-0 z-10 flex min-h-[min(360px,42vh)] items-center justify-center pointer-events-none">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        )}
        <div
          className={`relative flex flex-row gap-1 md:gap-8 w-full items-end justify-center perspective-1000 touch-pan-y transition-opacity duration-200 ease-out ${
            postersVisible || isSubmitting || isSkipping ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            transform: swipeOffset !== 0 ? `translateX(${swipeOffset * 0.3}px)` : 'none',
            transition: 'none',
          }}
        >
          <Fragment key={`left-${leftMovie.id}-${round}`}>
            {renderMovieCard(leftMovie, "left", leftPosterUrl, onPosterLoad)}
          </Fragment>

          <div className={`flex items-center justify-center ${activeSelection ? "opacity-0" : "opacity-100"}`}>
            <span
              className="text-4xl md:text-7xl font-black select-none"
              style={{
                fontFamily: "var(--font-display)",
                color: "#ff2d55",
                WebkitTextStroke: "2px white",
                textShadow:
                  "0 0 8px rgba(255,45,85,0.9), 0 0 20px rgba(255,45,85,0.7), 0 0 40px rgba(255,45,85,0.5), 0 0 80px rgba(255,45,85,0.3)",
                letterSpacing: "0.05em",
              }}
            >
              VS
            </span>
          </div>

          <Fragment key={`right-${rightMovie.id}-${round}`}>
            {renderMovieCard(rightMovie, "right", rightPosterUrl, onPosterLoad)}
          </Fragment>
        </div>
      </div>

      {/* Skip button - bold and prominent */}
      {onSkip && !activeSelection && postersVisible && (
        <Button
          variant="secondary"
          size="default"
          onClick={onSkip}
          disabled={isSubmitting || isAnimating || isSkipping}
          className="mt-2 font-semibold"
          data-testid="button-skip-round"
        >
          <Shuffle className="w-4 h-4 mr-2" />
          Skip this pair
        </Button>
      )}

      {/* Swipe hint - mobile only */}
      <p className="text-muted-foreground/40 text-[10px] text-center md:hidden">
        Swipe left/right or tap • Tap title for details
      </p>

      {showAuthModal && (
        <AuthPromptModal
          heading="Save your picks & build your taste profile"
          triggerSource="watchlist"
          onSkip={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}
