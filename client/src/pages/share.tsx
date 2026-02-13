import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import type { RecommendationsResponse, Recommendation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Film, Palette, Calendar, Sparkles, ChevronLeft, ChevronRight, Play, Brain, Home, Bookmark } from "lucide-react";
import { useState, useEffect } from "react";

interface SharedRecommendationsData {
  recommendations: Recommendation[];
  preferenceProfile: RecommendationsResponse["preferenceProfile"];
  createdAt: string;
}

export default function SharePage() {
  const params = useParams<{ id: string }>();
  const shareId = params.id;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoPlayTrailer, setAutoPlayTrailer] = useState(true);
  const [trailerIndex, setTrailerIndex] = useState(0);
  const [allTrailersFailed, setAllTrailersFailed] = useState(false);

  // Reset trailer state when changing movies
  useEffect(() => {
    setTrailerIndex(0);
    setAllTrailersFailed(false);
  }, [currentIndex]);

  const { data, isLoading, error } = useQuery<SharedRecommendationsData>({
    queryKey: ["/api/share", shareId],
    enabled: !!shareId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading recommendations...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Recommendations Not Found</h1>
          <p className="text-muted-foreground mb-6">This share link may have expired or doesn't exist.</p>
          <Link href="/">
            <Button className="gap-2" data-testid="button-go-home">
              <Home className="w-4 h-4" />
              Find Your Own Picks
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { recommendations, preferenceProfile } = data;
  const currentRec = recommendations[currentIndex];
  const totalRecs = recommendations.length;

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

  const posterUrl = currentRec?.movie.posterPath
    ? currentRec.movie.posterPath.startsWith("http")
      ? currentRec.movie.posterPath
      : `https://image.tmdb.org/t/p/w500${currentRec.movie.posterPath}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-col items-center gap-2 md:gap-3 w-full max-w-5xl mx-auto px-2 md:px-4 py-4 md:py-6">
        <div className="w-full flex justify-end">
          <Link href="/watchlist">
            <Button variant="ghost" className="gap-2" data-testid="button-watchlist">
              <Bookmark className="w-4 h-4" />
              My Watchlist
            </Button>
          </Link>
        </div>

        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Brain className="w-5 h-5 md:w-6 md:h-6 text-primary" />
            <h1 className="text-lg md:text-2xl font-bold text-foreground">
              Movie Picks for You
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Someone shared their WhatWeWatching recommendations with you!
          </p>
        </div>

        {/* Mobile Taste Summary */}
        {(preferenceProfile.visualStyle || preferenceProfile.mood) && (
          <p className="md:hidden text-white/70 text-xs text-center px-4 max-w-sm" data-testid="mobile-taste-summary">
            {preferenceProfile.visualStyle || preferenceProfile.mood}
          </p>
        )}

        {/* Preference Profile - Desktop only */}
        <div className="hidden md:flex flex-wrap items-center justify-center gap-2 text-sm max-w-4xl">
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

        {/* Movie Counter */}
        <div className="flex items-center gap-2">
          <span className="text-xs md:text-sm font-medium text-muted-foreground">
            {currentIndex + 1} / {totalRecs}
          </span>
          <div className="flex gap-1">
            {recommendations.map((rec, i) => (
              <button
                key={rec.movie.tmdbId}
                onClick={() => { setCurrentIndex(i); setAutoPlayTrailer(true); }}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === currentIndex ? "bg-primary w-4" : "bg-muted-foreground/30"
                }`}
                data-testid={`dot-indicator-${i}`}
              />
            ))}
          </div>
        </div>

        {/* Current Recommendation */}
        <div 
          className="w-full max-w-4xl bg-card/50 border border-border/50 rounded-xl md:rounded-2xl overflow-hidden backdrop-blur-sm"
          data-testid={`shared-recommendation-card-${currentIndex}`}
        >
          {/* Trailer / Poster Area */}
          <div className="aspect-video max-h-[40vh] md:max-h-[50vh] relative">
            {(() => {
              const availableTrailers = currentRec?.trailerUrls?.length
                ? currentRec.trailerUrls
                : currentRec?.trailerUrl
                  ? [currentRec.trailerUrl]
                  : [];
              const currentTrailerUrl = availableTrailers[trailerIndex];
              const hasMoreTrailers = trailerIndex < availableTrailers.length - 1;

              const handleTrailerError = () => {
                if (hasMoreTrailers) {
                  setTrailerIndex((prev) => prev + 1);
                } else {
                  setAllTrailersFailed(true);
                }
              };

              if (currentTrailerUrl && autoPlayTrailer && !allTrailersFailed) {
                return (
                  <div className="relative w-full h-full">
                    <iframe
                      key={currentTrailerUrl}
                      src={`${currentTrailerUrl}?autoplay=1&playsinline=1&rel=0&origin=${window.location.origin}`}
                      className="w-full h-full"
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                      title={`${currentRec.movie.title} Trailer`}
                      onError={handleTrailerError}
                    />
                  </div>
                );
              }

              if (posterUrl) {
                return (
                  <div className="relative w-full h-full">
                    <img
                      src={posterUrl}
                      alt={currentRec?.movie.title}
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
              }

              return (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <span className="text-muted-foreground text-sm">No Preview Available</span>
                </div>
              );
            })()}
          </div>

          {/* Movie Info */}
          <div className="p-3 md:p-4">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <h3 className="font-bold text-base md:text-xl text-foreground" data-testid="text-movie-title">
                {currentRec?.movie.title}
              </h3>
              <span className="text-muted-foreground text-sm shrink-0" data-testid="text-movie-year">
                {currentRec?.movie.year}
              </span>
              {currentRec?.movie.rating && (
                <Badge variant="secondary" className="bg-primary/20 text-primary border-0 shrink-0 text-sm" data-testid="text-movie-rating">
                  {currentRec.movie.rating.toFixed(1)}★
                </Badge>
              )}
            </div>
            
            <p className="text-foreground/70 text-sm leading-relaxed mt-2 line-clamp-2" data-testid="text-movie-reason">
              {currentRec?.reason}
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

          <Link href="/">
            <Button 
              size="default" 
              variant="default"
              className="gap-1.5"
              data-testid="button-try-whatwewatching"
            >
              <Film className="w-4 h-4" />
              Find Your Own Picks
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
