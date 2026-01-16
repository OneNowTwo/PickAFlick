import type { Movie } from "@shared/schema";
import { Film, PlayCircle } from "lucide-react";

interface TrailerCardProps {
  movie: Movie;
  trailerUrl: string | null;
  rerollToken: number;
}

export function TrailerCard({ movie, trailerUrl, rerollToken }: TrailerCardProps) {
  const posterUrl = movie.posterPath
    ? `https://image.tmdb.org/t/p/w300${movie.posterPath}`
    : null;

  return (
    <div
      className="min-w-[280px] w-[85vw] max-w-sm snap-start animate-fade-in"
      data-testid={`trailer-card-${movie.id}`}
    >
      <div className="rounded-lg overflow-hidden bg-card border border-card-border">
        <div className="aspect-video relative">
          {trailerUrl ? (
            <iframe
              key={`${movie.id}-${rerollToken}`}
              src={trailerUrl}
              title={`${movie.title} trailer`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="w-full h-full bg-muted flex flex-col items-center justify-center gap-3">
              {posterUrl ? (
                <div className="absolute inset-0">
                  <img
                    src={posterUrl}
                    alt={movie.title}
                    className="w-full h-full object-cover opacity-30 blur-sm"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <PlayCircle className="w-12 h-12 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground font-medium">
                      Trailer unavailable
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <Film className="w-12 h-12 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground font-medium">
                    Trailer unavailable
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="p-3">
          <h3 className="text-sm font-medium text-foreground truncate">
            {movie.title}
          </h3>
          {movie.year && (
            <p className="text-xs text-muted-foreground mt-0.5">{movie.year}</p>
          )}
        </div>
      </div>
    </div>
  );
}
