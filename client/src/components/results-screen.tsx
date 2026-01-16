import type { RecommendationsResponse } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { useState } from "react";

interface ResultsScreenProps {
  recommendations: RecommendationsResponse | null;
  isLoading: boolean;
  onPlayAgain: () => void;
}

export function ResultsScreen({ recommendations, isLoading, onPlayAgain }: ResultsScreenProps) {
  const [playingTrailer, setPlayingTrailer] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 min-h-[60vh]" data-testid="loading-recommendations">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Analyzing Your Taste...</h2>
          <p className="text-muted-foreground">Our AI is finding the perfect movies for you</p>
        </div>
      </div>
    );
  }

  if (!recommendations || recommendations.recommendations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 min-h-[60vh]">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">No Recommendations Found</h2>
          <p className="text-muted-foreground">Try playing again with different choices</p>
        </div>
        <Button size="lg" onClick={onPlayAgain} data-testid="button-play-again">
          <RefreshCw className="w-5 h-5 mr-2" />
          Play Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-6xl mx-auto px-4 py-8">
      <div className="text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
          Your Perfect Movies
        </h2>
        <p className="text-muted-foreground text-lg">
          Based on your choices, you love{" "}
          <span className="text-primary font-semibold">
            {recommendations.preferenceProfile.topGenres.join(", ")}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {recommendations.recommendations.map((rec, index) => {
          const posterUrl = rec.movie.posterPath
            ? rec.movie.posterPath.startsWith("http")
              ? rec.movie.posterPath
              : `https://image.tmdb.org/t/p/w500${rec.movie.posterPath}`
            : null;

          return (
            <div
              key={rec.movie.id}
              className="bg-card border border-border rounded-xl overflow-hidden"
              data-testid={`recommendation-card-${index}`}
            >
              {playingTrailer === rec.movie.id && rec.trailerUrl ? (
                <div className="aspect-video">
                  <iframe
                    src={`${rec.trailerUrl}?autoplay=1`}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    title={`${rec.movie.title} Trailer`}
                  />
                </div>
              ) : (
                <div className="relative aspect-video">
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={rec.movie.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <span className="text-muted-foreground">No Image</span>
                    </div>
                  )}
                  
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    {rec.trailerUrl && (
                      <Button
                        size="lg"
                        onClick={() => setPlayingTrailer(rec.movie.id)}
                        className="gap-2"
                        data-testid={`button-play-trailer-${index}`}
                      >
                        <Play className="w-5 h-5" />
                        Watch Trailer
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="p-4">
                <h3 className="font-bold text-lg text-foreground line-clamp-1">
                  {rec.movie.title}
                </h3>
                <p className="text-sm text-muted-foreground mb-2">
                  {rec.movie.year} {rec.movie.rating ? `• ${rec.movie.rating.toFixed(1)}★` : ""}
                </p>
                <p className="text-sm text-foreground/80 line-clamp-2">
                  {rec.reason}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <Button 
        size="lg" 
        onClick={onPlayAgain} 
        className="mt-4"
        data-testid="button-play-again"
      >
        <RefreshCw className="w-5 h-5 mr-2" />
        Play Again
      </Button>
    </div>
  );
}
