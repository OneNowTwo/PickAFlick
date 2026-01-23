import type { RecommendationsResponse, WatchProvidersResponse } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RefreshCw, Film, Palette, Calendar, Sparkles, ChevronLeft, ChevronRight, ThumbsUp, Bookmark, Tv, Brain } from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Generate personalized reveal message based on preference profile
function generateRevealMessage(profile: RecommendationsResponse["preferenceProfile"]): string {
  const parts: string[] = [];
  
  if (profile.topGenres.length >= 2) {
    parts.push(`You're in the mood for some ${profile.topGenres[0]} with a ${profile.topGenres[1]} twist`);
  } else if (profile.topGenres.length === 1) {
    parts.push(`You're craving some ${profile.topGenres[0]}`);
  }
  
  if (profile.mood) {
    const moodLower = profile.mood.toLowerCase();
    if (moodLower.includes("intense") || moodLower.includes("dark")) {
      parts.push("something with edge and intensity");
    } else if (moodLower.includes("light") || moodLower.includes("fun")) {
      parts.push("something light and enjoyable");
    } else if (moodLower.includes("thought") || moodLower.includes("deep")) {
      parts.push("something to really think about");
    }
  }
  
  if (profile.preferredEras && profile.preferredEras.length > 0) {
    const era = profile.preferredEras[0].toLowerCase();
    if (era.includes("modern") || era.includes("recent") || era.includes("2020") || era.includes("2010")) {
      parts.push("from the modern era");
    } else if (era.includes("classic") || era.includes("80s") || era.includes("90s")) {
      parts.push("with that classic feel");
    }
  }
  
  if (parts.length === 0) {
    return "We've figured out exactly what you're in the mood for!";
  }
  
  return parts.join(", ") + ". Here's what we picked for you!";
}

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
    queryKey: [`/api/watch-providers/${currentTmdbId}`],
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
        {/* Dark backdrop for better text visibility */}
        <div className="bg-black/60 backdrop-blur-sm rounded-2xl p-8 flex flex-col items-center gap-6">
          <div className="relative" style={{ width: 120, height: 120 }}>
            {/* Animated closing ring */}
            <svg className="transform -rotate-90 animate-pulse" width={120} height={120}>
              <circle
                cx={60}
                cy={60}
                r={54}
                stroke="currentColor"
                strokeWidth={8}
                fill="none"
                className="text-white/30"
              />
              <circle
                cx={60}
                cy={60}
                r={54}
                stroke="currentColor"
                strokeWidth={8}
                fill="none"
                strokeLinecap="round"
                className="text-white"
                style={{
                  strokeDasharray: 339.292,
                  strokeDashoffset: 0,
                  animation: "ring-close 2s ease-in-out infinite",
                }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Brain className="w-10 h-10 text-white animate-pulse" />
            </div>
          </div>
          <div className="text-center">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Hold a tic...</h2>
            <p className="text-white/80 text-sm md:text-base">We're picking your perfect movies!</p>
          </div>
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
  const revealMessage = generateRevealMessage(preferenceProfile);

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
    <div className="flex flex-col items-center gap-3 md:gap-6 w-full max-w-5xl mx-auto px-2 md:px-4 py-2 md:py-6">
      {/* Header with personalized reveal message */}
      <div className="text-center max-w-3xl">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Brain className="w-6 h-6 md:w-8 md:h-8 text-primary" />
          <h2 className="text-xl md:text-3xl font-bold text-foreground">
            We've Got It!
          </h2>
        </div>
        <p className="text-primary font-medium text-sm md:text-lg mb-1">
          {revealMessage}
        </p>
        <p className="text-muted-foreground text-xs md:text-sm hidden md:block">
          Swipe through your personalized recommendations below
        </p>
      </div>

      {/* Preference Profile Cards - Compact horizontal layout */}
      <div className="hidden md:grid grid-cols-4 gap-2 w-full" data-testid="preference-profile">
        {preferenceProfile.topGenres.length > 0 && (
          <div className="bg-black/70 border border-white/10 rounded-lg p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
              <Film className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-white/70">Genres</span>
            </div>
            <p className="text-white text-sm font-medium">
              {preferenceProfile.topGenres.slice(0, 3).join(", ")}
            </p>
          </div>
        )}

        {preferenceProfile.preferredEras && preferenceProfile.preferredEras.length > 0 && (
          <div className="bg-black/70 border border-white/10 rounded-lg p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-white/70">Eras</span>
            </div>
            <p className="text-white text-sm font-medium">
              {preferenceProfile.preferredEras.slice(0, 3).join(", ")}
            </p>
          </div>
        )}

        {preferenceProfile.visualStyle && (
          <div className="bg-black/70 border border-white/10 rounded-lg p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
              <Palette className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-white/70">Visual Style</span>
            </div>
            <p className="text-white text-sm leading-snug">
              {preferenceProfile.visualStyle}
            </p>
          </div>
        )}

        {preferenceProfile.mood && (
          <div className="bg-black/70 border border-white/10 rounded-lg p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-white/70">Mood</span>
            </div>
            <p className="text-white text-sm leading-snug">
              {preferenceProfile.mood}
            </p>
          </div>
        )}
      </div>

      {/* Themes - Hidden on mobile */}
      {preferenceProfile.themes && preferenceProfile.themes.length > 0 && (
        <div className="hidden md:flex flex-wrap items-center justify-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/70" />
          <span className="text-sm text-muted-foreground">Key themes:</span>
          {preferenceProfile.themes.slice(0, 4).map((theme, i) => (
            <span key={i} className="text-xs bg-primary/15 text-primary px-2.5 py-1 rounded-full">
              {theme}
            </span>
          ))}
        </div>
      )}

      {/* Divider - Hidden on mobile */}
      <div className="hidden md:block w-full max-w-lg border-t border-border/30" />

      {/* Movie Counter - Inline with navigation on mobile */}
      <div className="flex items-center gap-2 md:gap-3">
        <h3 className="text-sm md:text-lg font-semibold text-foreground">
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
        className="w-full max-w-3xl bg-card/50 border border-border/50 rounded-xl md:rounded-2xl overflow-hidden backdrop-blur-sm"
        data-testid={`recommendation-card-${currentIndex}`}
      >
        {/* Trailer / Poster Area - Slightly shorter on mobile */}
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
                    size="default"
                    onClick={() => setAutoPlayTrailer(true)}
                    className="gap-2"
                    data-testid={`button-play-trailer-${currentIndex}`}
                  >
                    <Play className="w-4 h-4 md:w-5 md:h-5" />
                    <span className="text-sm md:text-base">Watch Trailer</span>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground text-sm">No Preview Available</span>
            </div>
          )}
        </div>

        {/* Movie Info - More compact on mobile */}
        <div className="p-3 md:p-5">
          <div className="flex items-start justify-between gap-2 md:gap-4 mb-2 md:mb-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-lg md:text-2xl text-foreground line-clamp-2">
                {currentRec.movie.title}
              </h3>
              <p className="text-muted-foreground text-xs md:text-base">
                {currentRec.movie.year} {currentRec.movie.rating ? `• ${currentRec.movie.rating.toFixed(1)}★` : ""}
                {currentRec.movie.runtime ? ` • ${currentRec.movie.runtime} min` : ""}
              </p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowWatchProviders(true)}
              className="gap-1.5 shrink-0"
              data-testid="button-watch-now"
            >
              <Tv className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="text-xs md:text-sm">Watch Now</span>
            </Button>
          </div>
          
          {currentRec.movie.genres.length > 0 && (
            <div className="flex flex-wrap gap-1 md:gap-1.5 mb-2 md:mb-4">
              {currentRec.movie.genres.slice(0, 3).map((genre, i) => (
                <span key={i} className="text-[10px] md:text-xs bg-muted px-1.5 md:px-2 py-0.5 rounded text-muted-foreground">
                  {genre}
                </span>
              ))}
            </div>
          )}
          
          <p className="text-foreground/90 text-xs md:text-base leading-relaxed line-clamp-3 md:line-clamp-none">
            {currentRec.reason}
          </p>
        </div>
      </div>

      {/* Navigation Controls - More compact on mobile */}
      <div className="flex flex-col items-center gap-2 md:gap-4 w-full max-w-lg">
        {/* Back / Next Row */}
        <div className="flex items-center justify-between w-full gap-2 md:gap-4">
          <Button
            variant="outline"
            size="default"
            onClick={handleBack}
            disabled={currentIndex === 0}
            className="flex-1 gap-1 md:gap-2"
            data-testid="button-back"
          >
            <ChevronLeft className="w-4 h-4 md:w-5 md:h-5" />
            <span className="text-sm md:text-base">Back</span>
          </Button>

          <Button
            variant="outline"
            size="default"
            onClick={handleNext}
            disabled={currentIndex === totalRecs - 1}
            className="flex-1 gap-1 md:gap-2"
            data-testid="button-next"
          >
            <span className="text-sm md:text-base">Next</span>
            <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
          </Button>
        </div>

        {/* Like / Maybe Row */}
        <div className="flex items-center justify-center gap-2 md:gap-3 w-full">
          <Button
            variant={isMaybe ? "default" : "outline"}
            size="default"
            onClick={handleMaybe}
            className={`flex-1 gap-1 md:gap-2 toggle-elevate ${isMaybe ? "toggle-elevated bg-yellow-600 border-yellow-600" : ""}`}
            data-testid="button-maybe"
          >
            <Bookmark className="w-4 h-4" />
            <span className="text-sm md:text-base">Maybe</span>
          </Button>

          <Button
            variant={isLiked ? "default" : "outline"}
            size="default"
            onClick={handleLike}
            className={`flex-1 gap-1 md:gap-2 toggle-elevate ${isLiked ? "toggle-elevated bg-green-600 border-green-600" : ""}`}
            data-testid="button-like"
          >
            <ThumbsUp className="w-4 h-4" />
            <span className="text-sm md:text-base">Like</span>
          </Button>
        </div>
      </div>

      {/* Summary of liked/maybe - Smaller on mobile */}
      {(likedMovies.size > 0 || maybeMovies.size > 0) && (
        <div className="flex items-center justify-center gap-3 md:gap-4 text-xs md:text-sm text-muted-foreground">
          {likedMovies.size > 0 && (
            <span className="flex items-center gap-1">
              <ThumbsUp className="w-3 h-3 md:w-3.5 md:h-3.5 text-green-500" />
              {likedMovies.size} liked
            </span>
          )}
          {maybeMovies.size > 0 && (
            <span className="flex items-center gap-1">
              <Bookmark className="w-3 h-3 md:w-3.5 md:h-3.5 text-yellow-500" />
              {maybeMovies.size} maybe
            </span>
          )}
        </div>
      )}

      {/* Play Again - Smaller on mobile */}
      <Button 
        size="default" 
        variant="outline"
        onClick={onPlayAgain} 
        className="mt-1 md:mt-2"
        data-testid="button-play-again"
      >
        <RefreshCw className="w-4 h-4 md:w-5 md:h-5 mr-1.5 md:mr-2" />
        <span className="text-sm md:text-base">Start Over</span>
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
