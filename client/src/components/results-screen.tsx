import type { RecommendationsResponse, WatchProvidersResponse, Recommendation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RefreshCw, Film, Palette, Calendar, Sparkles, ChevronLeft, ChevronRight, ThumbsUp, Bookmark, Tv, Brain, Eye, Share2, Check, Copy } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShareCard } from "./share-card";

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
  sessionId?: string | null; // Needed for replacement requests
}

export function ResultsScreen({ recommendations, isLoading, onPlayAgain, sessionId }: ResultsScreenProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likedMovies, setLikedMovies] = useState<Set<number>>(new Set());
  const [maybeMovies, setMaybeMovies] = useState<Set<number>>(new Set());
  const [seenMovies, setSeenMovies] = useState<Set<number>>(new Set()); // Track "seen it" movies
  const [localRecs, setLocalRecs] = useState<Recommendation[]>([]); // Local mutable recs
  const [autoPlayTrailer, setAutoPlayTrailer] = useState(true);
  const [showWatchProviders, setShowWatchProviders] = useState(false);
  const [trailerIndex, setTrailerIndex] = useState(0); // Track which trailer we're trying
  const [allTrailersFailed, setAllTrailersFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStage, setLoadingStage] = useState("Analyzing your choices...");
  const [hasInteracted, setHasInteracted] = useState(false); // Track if user has clicked anything
  const { toast } = useToast();

  // Track when results screen loads with recommendations
  useEffect(() => {
    if (!isLoading && recommendations) {
      if (typeof window !== 'undefined' && window.posthog) {
        window.posthog.capture("completed_flow");
      }
    }
  }, [isLoading, recommendations]);

  // Reset trailer state when changing movies
  useEffect(() => {
    setTrailerIndex(0);
    setAllTrailersFailed(false);
  }, [currentIndex]);

  // Simulated loading progress with realistic stages
  useEffect(() => {
    if (!isLoading) {
      setLoadingProgress(0);
      setLoadingStage("Analyzing your choices...");
      return;
    }

    // Simulate progress with realistic timing
    const stages = [
      { progress: 20, message: "Analyzing your choices...", duration: 2000 },
      { progress: 40, message: "Exploring film history...", duration: 3000 },
      { progress: 60, message: "Finding hidden gems...", duration: 3000 },
      { progress: 75, message: "Checking availability...", duration: 2500 },
      { progress: 90, message: "Almost there...", duration: 2000 },
    ];

    let currentStage = 0;
    const interval = setInterval(() => {
      if (currentStage < stages.length) {
        setLoadingProgress(stages[currentStage].progress);
        setLoadingStage(stages[currentStage].message);
        currentStage++;
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isLoading]);

  // Initialize local recs from recommendations
  useEffect(() => {
    if (recommendations?.recommendations) {
      setLocalRecs([...recommendations.recommendations]);
    }
  }, [recommendations]);

  // Mutation to get a replacement recommendation
  const replacementMutation = useMutation({
    mutationFn: async (excludeTmdbIds: number[]) => {
      const res = await apiRequest("POST", `/api/session/${sessionId}/replacement`, { excludeTmdbIds });
      return res.json() as Promise<Recommendation>;
    },
    onSuccess: (newRec) => {
      // Add the new recommendation to the end
      setLocalRecs(prev => [...prev, newRec]);
      toast({
        title: "New recommendation added",
        description: `"${newRec.movie.title}" has been added to your picks!`,
      });
    },
    onError: () => {
      toast({
        title: "No more recommendations",
        description: "We couldn't find another movie to suggest.",
        variant: "destructive",
      });
    },
  });

  // Filter out "seen it" movies for display
  const displayRecs = localRecs.filter(r => !seenMovies.has(r.movie.tmdbId));
  const currentRec = displayRecs[currentIndex];
  const currentTmdbId = currentRec?.movie.tmdbId;

  const { data: watchProviders, isLoading: isLoadingProviders } = useQuery<WatchProvidersResponse>({
    queryKey: [`/api/watch-providers/${currentTmdbId}?title=${encodeURIComponent(currentRec?.movie.title || '')}&year=${currentRec?.movie.year || ''}`],
    enabled: showWatchProviders && !!currentTmdbId && !!currentRec,
  });

  // Handle "Seen It" - remove current and fetch replacement
  const handleSeenIt = () => {
    if (!currentRec || !sessionId) return;
    
    // Add to seen set
    const tmdbId = currentRec.movie.tmdbId;
    const newSeenMovies = new Set(seenMovies);
    newSeenMovies.add(tmdbId);
    setSeenMovies(newSeenMovies);
    
    // Build list of all tmdbIds to exclude (including previously seen and current recs)
    const allExcludedIds = [
      ...Array.from(seenMovies),
      tmdbId,
      ...localRecs.map(r => r.movie.tmdbId),
    ];
    
    // Request a replacement
    replacementMutation.mutate(allExcludedIds);
    
    // Adjust index if we were at the end
    const newDisplayRecs = displayRecs.filter(r => r.movie.tmdbId !== tmdbId);
    if (currentIndex >= newDisplayRecs.length && newDisplayRecs.length > 0) {
      setCurrentIndex(newDisplayRecs.length - 1);
    }
    
    setAutoPlayTrailer(true);
  };

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

  // Share mutation - generates link and shows share card
  const shareMutation = useMutation({
    mutationFn: async () => {
      if (!recommendations) throw new Error("No recommendations to share");
      const res = await apiRequest("POST", "/api/share", {
        recommendations: recommendations.recommendations,
        preferenceProfile: recommendations.preferenceProfile,
      });
      return res.json() as Promise<{ shareId: string }>;
    },
    onSuccess: async (data) => {
      const url = `${window.location.origin}/share/${data.shareId}`;
      setShareUrl(url);
      setShowShareCard(true);
    },
    onError: () => {
      toast({
        title: "Failed to share",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 min-h-[60vh]" data-testid="loading-recommendations">
        {/* Dark backdrop for better text visibility */}
        <div className="bg-black/60 backdrop-blur-sm rounded-2xl p-8 flex flex-col items-center gap-6 min-w-[320px] max-w-md">
          <div className="relative" style={{ width: 120, height: 120 }}>
            {/* Animated closing ring */}
            <svg className="transform -rotate-90" width={120} height={120}>
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
                className="text-white transition-all duration-500 ease-out"
                style={{
                  strokeDasharray: 339.292,
                  strokeDashoffset: 339.292 * (1 - loadingProgress / 100),
                }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Brain className="w-10 h-10 text-white animate-pulse" />
            </div>
          </div>
          <div className="text-center w-full px-4">
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Hold a tic...</h2>
            <p className="text-white/80 text-sm md:text-base mb-4">{loadingStage}</p>
            
            {/* Progress Bar */}
            <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-primary via-primary/80 to-primary/60 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="text-white/60 text-xs mt-3">{loadingProgress}% complete</p>
          </div>
        </div>
      </div>
    );
  }

  if (!recommendations || displayRecs.length === 0) {
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
  const totalRecs = displayRecs.length;
  const revealMessage = generateRevealMessage(preferenceProfile);

  const handleNext = () => {
    if (currentIndex < totalRecs - 1) {
      setHasInteracted(true); // Enable sound on mobile after first interaction
      setCurrentIndex(currentIndex + 1);
      setAutoPlayTrailer(true);
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      setHasInteracted(true); // Enable sound on mobile after first interaction
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

  // Generate a condensed taste summary for mobile that combines visual style and mood
  const mobileTasteSummary = (() => {
    const parts: string[] = [];
    if (preferenceProfile.visualStyle) {
      parts.push(preferenceProfile.visualStyle);
    }
    if (preferenceProfile.mood && preferenceProfile.mood !== preferenceProfile.visualStyle) {
      parts.push(preferenceProfile.mood);
    }
    if (parts.length === 0 && preferenceProfile.topGenres.length > 0) {
      return `You're drawn to ${preferenceProfile.topGenres.slice(0, 2).join(" and ")} films.`;
    }
    return parts.join(" ");
  })();

  return (
    <div className="flex flex-col items-center gap-2 md:gap-3 w-full max-w-5xl mx-auto px-2 md:px-4 pt-2 md:pt-3 pb-4 md:pb-6">
      {/* Movie Counter - Moved to top on mobile */}
      <div className="flex items-center gap-2 order-1 md:order-3">
        <span className="text-xs md:text-sm font-medium text-muted-foreground">
          {currentIndex + 1} / {totalRecs}
        </span>
        <div className="flex gap-1">
          {displayRecs.map((rec, i) => (
            <button
              key={rec.movie.tmdbId}
              onClick={() => { setCurrentIndex(i); setAutoPlayTrailer(true); }}
              className={`w-2 h-2 rounded-full transition-all ${
                i === currentIndex 
                  ? "bg-primary w-4" 
                  : likedMovies.has(rec.movie.id)
                    ? "bg-green-500"
                    : maybeMovies.has(rec.movie.id)
                      ? "bg-yellow-500"
                      : "bg-muted-foreground/30"
              }`}
              data-testid={`dot-indicator-${i}`}
            />
          ))}
        </div>
      </div>

      {/* Preference Summary - Hidden on mobile for space */}
      <div className="hidden md:flex flex-wrap items-center justify-center gap-2 text-sm max-w-4xl order-2" data-testid="preference-profile">
        {preferenceProfile.topGenres.length > 0 && (
          <Badge variant="secondary" className="bg-white/10 text-white/90 border-0 gap-1.5 py-1.5 px-3 text-sm">
            <Film className="w-4 h-4 text-primary" />
            {preferenceProfile.topGenres.slice(0, 3).join(" · ")}
          </Badge>
        )}
        {preferenceProfile.preferredEras && preferenceProfile.preferredEras.length > 0 && (
          <Badge variant="secondary" className="bg-white/10 text-white/90 border-0 gap-1.5 py-1.5 px-3 text-sm">
            <Calendar className="w-4 h-4 text-primary" />
            {preferenceProfile.preferredEras.slice(0, 2).join(", ")}
          </Badge>
        )}
        {preferenceProfile.visualStyle && (
          <Badge variant="secondary" className="bg-white/10 text-white/90 border-0 gap-1.5 py-1.5 px-3 text-sm">
            <Palette className="w-4 h-4 text-primary shrink-0" />
            {preferenceProfile.visualStyle}
          </Badge>
        )}
        {preferenceProfile.mood && (
          <Badge variant="secondary" className="bg-white/10 text-white/90 border-0 gap-1.5 py-1.5 px-3 text-sm">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            {preferenceProfile.mood}
          </Badge>
        )}
      </div>

      {/* Current Recommendation */}
      <div 
        className="w-full max-w-4xl bg-card/50 border border-border/50 rounded-xl md:rounded-2xl overflow-hidden backdrop-blur-sm"
        data-testid={`recommendation-card-${currentIndex}`}
      >
        {/* Trailer / Poster Area - Optimized height for mobile */}
        <div className="aspect-video max-h-[50vh] md:max-h-[70vh] relative">
          {(() => {
            // Get available trailers - use trailerUrls array or fall back to single trailerUrl
            const availableTrailers = currentRec.trailerUrls?.length 
              ? currentRec.trailerUrls 
              : currentRec.trailerUrl 
                ? [currentRec.trailerUrl] 
                : [];
            
            const currentTrailerUrl = availableTrailers[trailerIndex];
            const hasMoreTrailers = trailerIndex < availableTrailers.length - 1;
            
            // Handler to try next trailer
            const handleTrailerError = () => {
              if (hasMoreTrailers) {
                setTrailerIndex(prev => prev + 1);
              } else {
                setAllTrailersFailed(true);
              }
            };
            
            if (currentTrailerUrl && autoPlayTrailer && !allTrailersFailed) {
              // On mobile: first trailer muted (browser requirement), after first interaction all autoplay with sound
              const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
              const muteParam = (isMobile && !hasInteracted) ? 1 : 0;
              
              return (
                <div className="relative w-full h-full">
                  <iframe
                    key={currentTrailerUrl} // Force re-mount when URL changes
                    src={`${currentTrailerUrl}?autoplay=1&mute=${muteParam}&playsinline=1&rel=0&origin=${window.location.origin}`}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    title={`${currentRec.movie.title} Trailer`}
                    onError={handleTrailerError}
                    onLoad={() => {
                      if (typeof window !== 'undefined' && window.posthog) {
                        window.posthog.capture("trailer_played");
                      }
                    }}
                  />
                </div>
              );
            } else if (posterUrl) {
              return (
                <div className="relative w-full h-full">
                  <img
                    src={posterUrl}
                    alt={currentRec.movie.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-3">
                    {availableTrailers.length > 0 && !allTrailersFailed && (
                      <Button
                        size="default"
                        onClick={() => { setTrailerIndex(0); setAllTrailersFailed(false); setAutoPlayTrailer(true); }}
                        className="gap-2"
                        data-testid={`button-play-trailer-${currentIndex}`}
                      >
                        <Play className="w-4 h-4 md:w-5 md:h-5" />
                        <span className="text-sm md:text-base">Watch Trailer</span>
                      </Button>
                    )}
                    {allTrailersFailed && (
                      <div className="text-center px-4">
                        <p className="text-white/80 text-sm">All known trailer embeds for this title are unavailable.</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            } else {
              return (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <span className="text-muted-foreground text-sm">No Preview Available</span>
                </div>
              );
            }
          })()}
        </div>

        {/* Movie Info */}
        <div className="p-3 md:p-4">
          {/* Title row - stacks on mobile */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base md:text-xl text-foreground" data-testid="text-movie-title">
                {currentRec.movie.title}
              </h3>
              <span className="text-muted-foreground text-sm shrink-0" data-testid="text-movie-year">
                {currentRec.movie.year}
              </span>
              {currentRec.movie.rating && (
                <Badge variant="secondary" className="bg-primary/20 text-primary border-0 shrink-0 text-sm" data-testid="text-movie-rating">
                  {currentRec.movie.rating.toFixed(1)}★
                </Badge>
              )}
            </div>
            <Button
              variant="default"
              size="default"
              onClick={() => setShowWatchProviders(true)}
              className="gap-2 shrink-0 w-full md:w-auto"
              data-testid="button-watch-now"
            >
              <Tv className="w-4 h-4" />
              Click to Watch
            </Button>
          </div>
          
          <p className="text-foreground/70 text-sm leading-relaxed mt-2" data-testid="text-movie-reason">
            {currentRec.reason}
          </p>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="flex items-center justify-center gap-3 w-full flex-wrap">
        <Button
          variant="outline"
          size="default"
          onClick={handleBack}
          disabled={currentIndex === 0}
          className="gap-1.5"
          data-testid="button-back"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>

        <Button
          variant={isLiked ? "default" : "outline"}
          size="default"
          onClick={handleLike}
          className={`gap-1.5 toggle-elevate ${isLiked ? "toggle-elevated bg-green-600 border-green-600" : ""}`}
          data-testid="button-save-watchlist"
        >
          <Bookmark className="w-4 h-4" />
          {isLiked ? "Saved to Watchlist" : "Save to Watchlist"}
        </Button>

        <Button
          variant="outline"
          size="default"
          onClick={handleSeenIt}
          disabled={replacementMutation.isPending || !sessionId}
          className="gap-1.5"
          data-testid="button-seen-it"
        >
          {replacementMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          Seen It
        </Button>

        <Button
          variant="outline"
          size="default"
          onClick={handleNext}
          disabled={currentIndex === totalRecs - 1}
          className="gap-1.5"
          data-testid="button-next"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </Button>

        <Button 
          size="default" 
          variant="ghost"
          onClick={onPlayAgain}
          className="gap-1.5"
          data-testid="button-play-again"
        >
          <RefreshCw className="w-4 h-4" />
          Restart
        </Button>

        <Button 
          size="default" 
          variant="default"
          onClick={() => shareMutation.mutate()}
          disabled={shareMutation.isPending}
          className="gap-1.5"
          data-testid="button-share"
        >
          {shareMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Share2 className="w-4 h-4" />
          )}
          {copied ? "Copied!" : "Share"}
        </Button>
      </div>


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
                          href={provider.deepLink || "#"}
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
                          href={provider.deepLink || "#"}
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
                          href={provider.deepLink || "#"}
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
                  Providers from TMDb · Links from Flicks
                </p>
              </div>
            ) : (
              <div className="text-center py-8">
                <Tv className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No direct movie links found for this title in Australia.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Share Card Modal */}
      {recommendations && (
        <ShareCard
          isOpen={showShareCard}
          onClose={() => setShowShareCard(false)}
          recommendations={displayRecs}
          preferenceProfile={recommendations.preferenceProfile}
          shareUrl={shareUrl || undefined}
        />
      )}
    </div>
  );
}
