import { useState, useCallback } from "react";
import type { Movie } from "@shared/schema";
import { MovieCard } from "./movie-card";
import { SwipeControls } from "./swipe-controls";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, Sparkles } from "lucide-react";

interface CardStackProps {
  movies: Movie[];
  isLoading?: boolean;
  isError?: boolean;
  onShuffle: () => void;
  isShuffling?: boolean;
}

export function CardStack({ movies, isLoading, isError, onShuffle, isShuffling }: CardStackProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [exitingCard, setExitingCard] = useState<number | null>(null);

  const handleSwipeLeft = useCallback(() => {
    setExitingCard(currentIndex);
    setTimeout(() => {
      setCurrentIndex((prev) => prev + 1);
      setExitingCard(null);
    }, 400);
  }, [currentIndex]);

  const handleSwipeRight = useCallback(() => {
    setExitingCard(currentIndex);
    setTimeout(() => {
      setCurrentIndex((prev) => prev + 1);
      setExitingCard(null);
    }, 400);
  }, [currentIndex]);

  const handleShuffle = useCallback(() => {
    setCurrentIndex(0);
    setExitingCard(null);
    onShuffle();
  }, [onShuffle]);

  const remainingCount = movies.length - currentIndex;
  const isFinished = currentIndex >= movies.length && movies.length > 0;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-8 w-full max-w-md mx-auto px-4">
        <div className="relative w-full" style={{ aspectRatio: "2/3" }}>
          <Skeleton className="absolute inset-0 rounded-2xl" />
        </div>
        <div className="flex items-center justify-center gap-6">
          <Skeleton className="w-16 h-16 rounded-full" />
          <Skeleton className="w-12 h-12 rounded-full" />
          <Skeleton className="w-16 h-16 rounded-full" />
        </div>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div 
        className="flex flex-col items-center justify-center gap-6 w-full max-w-md mx-auto px-4 min-h-[60vh]"
        data-testid="empty-state"
      >
        <div className="text-center">
          <Sparkles className="w-16 h-16 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">That's all!</h2>
          <p className="text-muted-foreground">
            You've seen all the movies. Shuffle for more picks!
          </p>
        </div>
        <Button
          size="lg"
          onClick={handleShuffle}
          disabled={isShuffling}
          className="gap-2"
          data-testid="button-shuffle-empty"
        >
          <RefreshCw className={`w-5 h-5 ${isShuffling ? "animate-spin" : ""}`} />
          Shuffle for More
        </Button>
      </div>
    );
  }

  if (isError) {
    return (
      <div 
        className="flex flex-col items-center justify-center gap-6 w-full max-w-md mx-auto px-4 min-h-[60vh]"
        data-testid="error-state"
      >
        <div className="text-center">
          <p className="text-muted-foreground">
            Movies are loading... Please wait a moment.
          </p>
          <p className="text-sm text-muted-foreground/70 mt-2">
            Building the catalogue from curated lists.
          </p>
        </div>
        <Button
          size="lg"
          onClick={handleShuffle}
          disabled={isShuffling}
          className="gap-2"
          data-testid="button-retry"
        >
          <RefreshCw className={`w-5 h-5 ${isShuffling ? "animate-spin" : ""}`} />
          Retry
        </Button>
      </div>
    );
  }

  if (movies.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 w-full max-w-md mx-auto px-4 min-h-[60vh]">
        <div className="text-center">
          <p className="text-muted-foreground">
            No movies available. Try refreshing.
          </p>
        </div>
        <Button
          size="lg"
          onClick={handleShuffle}
          disabled={isShuffling}
          className="gap-2"
          data-testid="button-refresh-empty"
        >
          <RefreshCw className={`w-5 h-5 ${isShuffling ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
    );
  }

  const visibleMovies = movies.slice(currentIndex, currentIndex + 3);

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-md mx-auto px-4">
      <div className="text-sm text-muted-foreground font-medium">
        {remainingCount} movie{remainingCount !== 1 ? "s" : ""} left
      </div>
      
      <div 
        className="relative w-full" 
        style={{ aspectRatio: "2/3" }}
        data-testid="card-stack"
      >
        {visibleMovies.map((movie, index) => (
          <MovieCard
            key={movie.id}
            movie={movie}
            onSwipeLeft={handleSwipeLeft}
            onSwipeRight={handleSwipeRight}
            isActive={index === 0 && exitingCard === null}
            stackIndex={index}
          />
        ))}
      </div>

      <SwipeControls
        onPass={handleSwipeLeft}
        onLike={handleSwipeRight}
        onShuffle={handleShuffle}
        disabled={exitingCard !== null}
        isShuffling={isShuffling}
      />
    </div>
  );
}
