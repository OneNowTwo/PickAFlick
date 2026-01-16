import type { Movie } from "@shared/schema";
import { TrailerCard } from "./trailer-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Clapperboard } from "lucide-react";

interface TrailerSectionProps {
  movies: Movie[];
  trailers: Record<string, string | null>;
  isLoading?: boolean;
  rerollToken: number;
}

export function TrailerSection({ movies, trailers, isLoading, rerollToken }: TrailerSectionProps) {
  if (isLoading) {
    return (
      <section className="w-full px-4 py-6">
        <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
          <Clapperboard className="w-5 h-5" />
          Recommended Trailers
        </h2>
        <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 scrollbar-hide lg:grid lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="min-w-[280px] w-[85vw] max-w-sm snap-start">
              <Skeleton className="aspect-video rounded-lg" />
              <div className="mt-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/4 mt-1" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (movies.length === 0) {
    return null;
  }

  return (
    <section className="w-full px-4 py-6" data-testid="trailer-section">
      <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
        <Clapperboard className="w-5 h-5" />
        Recommended Trailers
      </h2>
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 scrollbar-hide lg:grid lg:grid-cols-3 lg:overflow-visible">
        {movies.map((movie) => (
          <TrailerCard
            key={`${movie.id}-${rerollToken}`}
            movie={movie}
            trailerUrl={trailers[movie.id.toString()] || null}
            rerollToken={rerollToken}
          />
        ))}
      </div>
    </section>
  );
}
