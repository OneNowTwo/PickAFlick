import type { RecommendationsResponse, WatchProvidersResponse } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RefreshCw, Film, Palette, Heart, Calendar, Sparkles, ChevronLeft, ChevronRight, ThumbsUp, Bookmark, Tv, X } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ResultsScreenProps {
  recommendations: RecommendationsResponse | null;
  isLoading: boolean;
  onPlayAgain: () => void;
}

export function ResultsScreen({ recommendations, isLoading, onPlayAgain }: ResultsScreenProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likedMovies, setLikedMovies] = useState<Set<number>>(new Set());
  const [maybeMovies, setMaybeMovies] = useState<Set<number>>(new Set());
  const [autoPlayTrailer, setAutoPlayTrailer] = useState(true);
  const [showWatchProviders, setShowWatchProviders] = useState(false);
  const { toast } = useToast();

  const currentTmdbId = recommendations?.recommendations[currentIndex]?.movie.tmdbId;

  const { data: watchProviders, isLoading: isLoadingProviders } = useQuery<WatchProvidersResponse>({
    queryKey: ["/api/watch-providers", currentTmdbId],
    enabled: showWatchProviders && !!currentTmdbId,
  });

  const addToWatchlistMutation = useMutation({
    mutationFn: async (movie: { tmdbId: number; title: string; year: number | null; posterPath: string | null; genres: string[]; rating: number | null }) => {
      const res = await apiRequest("POST", "/api/watchlist", movie);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({
        title: "Added to watchlist",
        description: "Movie saved to your watchlist!",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 min-h-[60vh]" data-testid="loading-recommendations">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
          <Loader2 className="relative w-16 h-16 animate-spin text-primary" />
        </div>
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
  const currentRec = recommendations.recommendations[currentIndex];
  const totalRecs = recommendations.recommendations.length;

  const handleNext = () => {
    if (currentIndex < totalRecs - 1) {
      setCurrentIndex(currentIndex + 1);
      setAutoPlayTrailer(true);
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setAutoPlayTrailer(true);
    }
  };

  const handleLike = () => {
    const movie = currentRec.movie;
    const movieId = movie.id;
    const newLiked = new Set(likedMovies);
    if (newLiked.has(movieId)) {
      newLiked.delete(movieId);
    } else {
      newLiked.add(movieId);
      maybeMovies.delete(movieId);
      setMaybeMovies(new Set(maybeMovies));
      addToWatchlistMutation.mutate({
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.year,
        posterPath: movie.posterPath,
        genres: movie.genres,
        rating: movie.rating,
      });
    }
    setLikedMovies(newLiked);
  };

  const handleMaybe = () => {
    const movieId = currentRec.movie.id;
    const newMaybe = new Set(maybeMovies);
    if (newMaybe.has(movieId)) {
      newMaybe.delete(movieId);
    } else {
      newMaybe.add(movieId);
      likedMovies.delete(movieId);
      setLikedMovies(new Set(likedMovies));
    }
    setMaybeMovies(newMaybe);
  };

  const isLiked = likedMovies.has(currentRec.movie.id);
  const isMaybe = maybeMovies.has(currentRec.movie.id);

  const posterUrl = currentRec.movie.posterPath
    ? currentRec.movie.posterPath.startsWith("http")
      ? currentRec.movie.posterPath
      : `https://image.tmdb.org/t/p/w500${currentRec.movie.posterPath}`
    : null;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center max-w-3xl">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
          Your Tailored Picks
        </h2>
        <p className="text-muted-foreground text-base">
          Based on your 7 choices, here's what we learned about your taste
        </p>
      </div>

      {/* Preference Profile Cards - Expanded for readability */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full" data-testid="preference-profile">
        {preferenceProfile.topGenres.length > 0 && (
          <div className="bg-card/80 border border-border/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-primary/10 rounded-md">
                <Film className="w-4 h-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Favorite Genres</span>
            </div>
            <p className="text-foreground text-sm leading-relaxed">
              {preferenceProfile.topGenres.slice(0, 4).join(", ")}
            </p>
          </div>
        )}

        {preferenceProfile.preferredEras && preferenceProfile.preferredEras.length > 0 && (
          <div className="bg-card/80 border border-border/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-primary/10 rounded-md">
                <Calendar className="w-4 h-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Preferred Eras</span>
            </div>
            <p className="text-foreground text-sm leading-relaxed">
              {preferenceProfile.preferredEras.slice(0, 3).join(", ")}
            </p>
          </div>
        )}

        {preferenceProfile.visualStyle && (
          <div className="bg-card/80 border border-border/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-primary/10 rounded-md">
                <Palette className="w-4 h-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Visual Style</span>
            </div>
            <p className="text-foreground text-sm leading-relaxed">
              {preferenceProfile.visualStyle}
            </p>
          </div>
        )}

        {preferenceProfile.mood && (
          <div className="bg-card/80 border border-border/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-primary/10 rounded-md">
                <Heart className="w-4 h-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Mood & Tone</span>
            </div>
            <p className="text-foreground text-sm leading-relaxed">
              {preferenceProfile.mood}
            </p>
          </div>
        )}
      </div>

      {/* Themes */}
      {preferenceProfile.themes && preferenceProfile.themes.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/70" />
          <span className="text-sm text-muted-foreground">Key themes:</span>
          {preferenceProfile.themes.slice(0, 4).map((theme, i) => (
            <span key={i} className="text-xs bg-primary/15 text-primary px-2.5 py-1 rounded-full">
              {theme}
            </span>
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="w-full max-w-lg border-t border-border/30" />

      {/* Movie Counter */}
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold text-foreground">
          Movie {currentIndex + 1} of {totalRecs}
        </h3>
        <div className="flex gap-1">
          {recommendations.recommendations.map((_, i) => (
            <button
              key={i}
              onClick={() => { setCurrentIndex(i); setAutoPlayTrailer(true); }}
              className={`w-2 h-2 rounded-full transition-all ${
                i === currentIndex 
                  ? "bg-primary w-4" 
                  : likedMovies.has(recommendations.recommendations[i].movie.id)
                    ? "bg-green-500"
                    : maybeMovies.has(recommendations.recommendations[i].movie.id)
                      ? "bg-yellow-500"
                      : "bg-muted-foreground/30"
              }`}
              data-testid={`dot-indicator-${i}`}
            />
          ))}
        </div>
      </div>

      {/* Current Recommendation */}
      <div 
        className="w-full max-w-3xl bg-card/50 border border-border/50 rounded-2xl overflow-hidden backdrop-blur-sm"
        data-testid={`recommendation-card-${currentIndex}`}
      >
        {/* Trailer / Poster Area */}
        <div className="aspect-video relative">
          {currentRec.trailerUrl && autoPlayTrailer ? (
            <iframe
              src={`${currentRec.trailerUrl}?autoplay=1`}
              className="w-full h-full"
              allow="autoplay; encrypted-media"
              allowFullScreen
              title={`${currentRec.movie.title} Trailer`}
            />
          ) : posterUrl ? (
            <div className="relative w-full h-full">
              <img
                src={posterUrl}
                alt={currentRec.movie.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                {currentRec.trailerUrl && (
                  <Button
                    size="lg"
                    onClick={() => setAutoPlayTrailer(true)}
                    className="gap-2"
                    data-testid={`button-play-trailer-${currentIndex}`}
                  >
                    <Play className="w-5 h-5" />
                    Watch Trailer
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground">No Preview Available</span>
            </div>
          )}
        </div>

        {/* Movie Info */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="font-bold text-xl md:text-2xl text-foreground">
                {currentRec.movie.title}
              </h3>
              <p className="text-muted-foreground">
                {currentRec.movie.year} {currentRec.movie.rating ? `• ${currentRec.movie.rating.toFixed(1)}★` : ""}
                {currentRec.movie.runtime ? ` • ${currentRec.movie.runtime} min` : ""}
              </p>
            </div>
            <Button
              variant="default"
              size="default"
              onClick={() => setShowWatchProviders(true)}
              className="gap-2 shrink-0"
              data-testid="button-watch-now"
            >
              <Tv className="w-4 h-4" />
              Watch Now
            </Button>
          </div>
          
          {currentRec.movie.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {currentRec.movie.genres.slice(0, 4).map((genre, i) => (
                <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">
                  {genre}
                </span>
              ))}
            </div>
          )}
          
          <p className="text-foreground/90 text-sm md:text-base leading-relaxed">
            {currentRec.reason}
          </p>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="flex flex-col items-center gap-4 w-full max-w-lg">
        {/* Back / Next Row - More prominent */}
        <div className="flex items-center justify-between w-full gap-4">
          <Button
            variant="outline"
            size="lg"
            onClick={handleBack}
            disabled={currentIndex === 0}
            className="flex-1 gap-2"
            data-testid="button-back"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </Button>

          <Button
            variant="outline"
            size="lg"
            onClick={handleNext}
            disabled={currentIndex === totalRecs - 1}
            className="flex-1 gap-2"
            data-testid="button-next"
          >
            Next
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        {/* Like / Maybe Row */}
        <div className="flex items-center justify-center gap-3 w-full">
          <Button
            variant={isMaybe ? "default" : "outline"}
            onClick={handleMaybe}
            className={`flex-1 gap-2 ${isMaybe ? "bg-yellow-600 hover:bg-yellow-700 border-yellow-600" : ""}`}
            data-testid="button-maybe"
          >
            <Bookmark className="w-4 h-4" />
            Maybe
          </Button>

          <Button
            variant={isLiked ? "default" : "outline"}
            onClick={handleLike}
            className={`flex-1 gap-2 ${isLiked ? "bg-green-600 hover:bg-green-700 border-green-600" : ""}`}
            data-testid="button-like"
          >
            <ThumbsUp className="w-4 h-4" />
            Like
          </Button>
        </div>
      </div>

      {/* Summary of liked/maybe */}
      {(likedMovies.size > 0 || maybeMovies.size > 0) && (
        <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
          {likedMovies.size > 0 && (
            <span className="flex items-center gap-1">
              <ThumbsUp className="w-3.5 h-3.5 text-green-500" />
              {likedMovies.size} liked
            </span>
          )}
          {maybeMovies.size > 0 && (
            <span className="flex items-center gap-1">
              <Bookmark className="w-3.5 h-3.5 text-yellow-500" />
              {maybeMovies.size} maybe
            </span>
          )}
        </div>
      )}

      {/* Play Again */}
      <Button 
        size="lg" 
        variant="outline"
        onClick={onPlayAgain} 
        className="mt-2"
        data-testid="button-play-again"
      >
        <RefreshCw className="w-5 h-5 mr-2" />
        Start Over
      </Button>

      {/* Watch Providers Dialog */}
      <Dialog open={showWatchProviders} onOpenChange={setShowWatchProviders}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tv className="w-5 h-5 text-primary" />
              Where to Watch
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            {isLoadingProviders ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : watchProviders && watchProviders.providers.length > 0 ? (
              <div className="space-y-4">
                {/* Subscription Services */}
                {watchProviders.providers.filter(p => p.type === "subscription").length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">Stream with Subscription</h4>
                    <div className="grid grid-cols-3 gap-3">
                      {watchProviders.providers.filter(p => p.type === "subscription").map((provider) => (
                        <a
                          key={provider.id}
                          href={watchProviders.link || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-2 p-3 bg-card border border-border rounded-lg hover-elevate transition-all"
                          data-testid={`provider-${provider.id}`}
                        >
                          <img
                            src={`https://image.tmdb.org/t/p/original${provider.logoPath}`}
                            alt={provider.name}
                            className="w-12 h-12 rounded-lg object-cover"
                          />
                          <span className="text-xs text-center text-muted-foreground line-clamp-2">{provider.name}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rent */}
                {watchProviders.providers.filter(p => p.type === "rent").length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">Rent</h4>
                    <div className="grid grid-cols-3 gap-3">
                      {watchProviders.providers.filter(p => p.type === "rent").map((provider) => (
                        <a
                          key={provider.id}
                          href={watchProviders.link || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-2 p-3 bg-card border border-border rounded-lg hover-elevate transition-all"
                          data-testid={`provider-rent-${provider.id}`}
                        >
                          <img
                            src={`https://image.tmdb.org/t/p/original${provider.logoPath}`}
                            alt={provider.name}
                            className="w-12 h-12 rounded-lg object-cover"
                          />
                          <span className="text-xs text-center text-muted-foreground line-clamp-2">{provider.name}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Buy */}
                {watchProviders.providers.filter(p => p.type === "buy").length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">Buy</h4>
                    <div className="grid grid-cols-3 gap-3">
                      {watchProviders.providers.filter(p => p.type === "buy").map((provider) => (
                        <a
                          key={provider.id}
                          href={watchProviders.link || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-2 p-3 bg-card border border-border rounded-lg hover-elevate transition-all"
                          data-testid={`provider-buy-${provider.id}`}
                        >
                          <img
                            src={`https://image.tmdb.org/t/p/original${provider.logoPath}`}
                            alt={provider.name}
                            className="w-12 h-12 rounded-lg object-cover"
                          />
                          <span className="text-xs text-center text-muted-foreground line-clamp-2">{provider.name}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground text-center mt-4">
                  Data provided by JustWatch via TMDb
                </p>
              </div>
            ) : (
              <div className="text-center py-8">
                <Tv className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No streaming options available in Australia for this title.</p>
                <p className="text-xs text-muted-foreground mt-2">Try searching for it directly on your favorite streaming service.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
