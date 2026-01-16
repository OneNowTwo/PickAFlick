import type { RecommendationsResponse } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RefreshCw, Film, Palette, Heart, Calendar, Sparkles } from "lucide-react";
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

  const { preferenceProfile } = recommendations;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-6xl mx-auto px-4 py-8">
      <div className="text-center max-w-3xl">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
          Your Perfect Movies
        </h2>
        <p className="text-muted-foreground text-lg mb-6">
          Based on your 7 choices, here's what we learned about your taste
        </p>
      </div>

      {/* Preference Profile Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-4xl" data-testid="preference-profile">
        {/* Genres */}
        {preferenceProfile.topGenres.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Film className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Favorite Genres</span>
            </div>
            <p className="text-foreground font-semibold">
              {preferenceProfile.topGenres.slice(0, 3).join(", ")}
            </p>
          </div>
        )}

        {/* Eras */}
        {preferenceProfile.preferredEras && preferenceProfile.preferredEras.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Preferred Eras</span>
            </div>
            <p className="text-foreground font-semibold">
              {preferenceProfile.preferredEras.slice(0, 2).join(", ")}
            </p>
          </div>
        )}

        {/* Visual Style */}
        {preferenceProfile.visualStyle && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Palette className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Visual Style</span>
            </div>
            <p className="text-foreground font-semibold line-clamp-2">
              {preferenceProfile.visualStyle}
            </p>
          </div>
        )}

        {/* Mood */}
        {preferenceProfile.mood && (
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Heart className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Mood & Tone</span>
            </div>
            <p className="text-foreground font-semibold line-clamp-2">
              {preferenceProfile.mood}
            </p>
          </div>
        )}
      </div>

      {/* Themes if available */}
      {preferenceProfile.themes && preferenceProfile.themes.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 max-w-2xl">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm text-muted-foreground">Key themes:</span>
          {preferenceProfile.themes.slice(0, 4).map((theme, i) => (
            <span key={i} className="text-sm bg-primary/10 text-primary px-2 py-1 rounded-md">
              {theme}
            </span>
          ))}
        </div>
      )}

      {/* Section divider */}
      <div className="w-full max-w-md border-t border-border" />

      <h3 className="text-xl font-bold text-foreground">
        Movies You'll Love
      </h3>

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
                <p className="text-sm text-foreground/80 line-clamp-3">
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
