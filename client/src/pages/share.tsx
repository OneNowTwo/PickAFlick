import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import type { RecommendationsResponse, Recommendation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Film, Palette, Calendar, Sparkles, ChevronLeft, ChevronRight, Play, Brain, Home, Bookmark, Mail, Tv } from "lucide-react";
import { Footer } from "@/components/footer";
import { PosterGridBackground } from "@/components/poster-grid-background";
import { useState, useEffect } from "react";

interface SharedRecommendationsData {
  recommendations: Recommendation[];
  preferenceProfile: RecommendationsResponse["preferenceProfile"];
  createdAt: string;
}

function sanitizeShareId(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/[^a-z0-9]/gi, "");
}

function ShareHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/">
          <span className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -ml-2 transition-colors cursor-pointer" data-testid="button-logo-home">
            <img src="/logo.png" alt="WhatWeWatching" className="w-48 md:w-64 h-auto" />
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/contact">
            <Button variant="ghost" className="gap-2" data-testid="button-contact">
              <Mail className="w-4 h-4" />
              <span className="hidden sm:inline">Contact</span>
            </Button>
          </Link>
          <Link href="/">
            <Button variant="ghost" className="gap-2" data-testid="button-home">
              <Film className="w-4 h-4" />
              <span className="hidden sm:inline">Home</span>
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function SharePage() {
  const params = useParams<{ id: string }>();
  const rawId = params.id;
  const shareId = sanitizeShareId(rawId);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoPlayTrailer, setAutoPlayTrailer] = useState(true);
  const [trailerIndex, setTrailerIndex] = useState(0);
  const [allTrailersFailed, setAllTrailersFailed] = useState(false);

  useEffect(() => {
    setTrailerIndex(0);
    setAllTrailersFailed(false);
  }, [currentIndex]);

  const { data, isLoading, error } = useQuery<SharedRecommendationsData>({
    queryKey: ["/api/share", shareId],
    enabled: !!shareId && shareId.length >= 6,
  });

  const hasInvalidId = rawId && shareId.length < 6;

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col">
        <PosterGridBackground />
        <ShareHeader />
        <main className="relative z-10 flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-white/70">Loading recommendations...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (hasInvalidId || error || !data) {
    return (
      <div className="min-h-screen w-full flex flex-col">
        <PosterGridBackground />
        <ShareHeader />
        <main className="relative z-10 flex-1 flex items-center justify-center px-4">
          <div className="text-center p-6 rounded-lg" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
            <h1 className="text-2xl font-bold text-white mb-2">Recommendations Not Found</h1>
            <p className="text-white/70 mb-6">
              {hasInvalidId
                ? "This link may be corrupted (e.g. from copy/paste). Ask your friend to share it again."
                : "This share link may have expired or doesn't exist."}
            </p>
            <Link href="/">
              <Button className="gap-2" data-testid="button-go-home">
                <Home className="w-4 h-4" />
                Find Your Own Picks
              </Button>
            </Link>
          </div>
        </main>
        <Footer />
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
    <div className="min-h-screen w-full flex flex-col">
      <PosterGridBackground />
      <ShareHeader />

      <main className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 md:py-4">
        <div className="flex flex-col items-center gap-1 md:gap-2 w-full">
          {/* Header */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Brain className="w-5 h-5 md:w-6 md:h-6 text-primary" />
              <h1 className="text-lg md:text-2xl font-bold text-white">
                Movie Picks for You
              </h1>
            </div>
            <p className="text-white/70 text-sm">
              Someone shared their WhatWeWatching recommendations with you!
            </p>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-center gap-3 w-full">
            <span className="text-base md:text-lg font-bold text-white">
              {currentIndex + 1} of {totalRecs}
            </span>
          </div>

          {/* Genre/year tags */}
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm max-w-4xl">
            {currentRec?.movie.genres?.length > 0 && (
              <Badge variant="secondary" className="bg-white/10 text-white/90 border-0 gap-1.5 py-1.5 px-3 text-sm">
                <Film className="w-4 h-4 text-primary" />
                {currentRec.movie.genres.slice(0, 3).join(" · ")}
              </Badge>
            )}
            {currentRec?.movie.year && (
              <Badge variant="secondary" className="bg-white/10 text-white/90 border-0 gap-1.5 py-1.5 px-3 text-sm">
                <Calendar className="w-4 h-4 text-primary" />
                {currentRec.movie.year}
              </Badge>
            )}
          </div>

          {/* Taste profile badges - desktop only */}
          <div className="hidden md:flex flex-wrap items-center justify-center gap-2 text-sm max-w-4xl">
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

          {/* Trailer card with nav */}
          <div className="flex flex-col md:flex-row md:items-stretch gap-2 md:gap-3 w-full max-w-7xl">
            {/* Previous - desktop only */}
            <Button
              variant="default"
              size="lg"
              onClick={handleBack}
              disabled={currentIndex === 0}
              className="hidden md:flex shrink-0 self-center gap-2 min-w-[90px] justify-center py-5"
              data-testid="button-back"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>

            {/* Card */}
            <div
              className="w-full md:flex-1 md:min-w-0 bg-card/50 border border-border/50 rounded-xl md:rounded-2xl overflow-hidden backdrop-blur-sm"
              data-testid={`shared-recommendation-card-${currentIndex}`}
            >
              {/* Trailer / Poster */}
              <div className="aspect-video w-full relative">
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
                          src={`${currentTrailerUrl}?autoplay=1&mute=1&playsinline=1&rel=0&origin=${window.location.origin}`}
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
                {currentRec?.reason && (
                  <p className="text-foreground/70 text-sm leading-relaxed mt-2" data-testid="text-movie-reason">
                    <span className="font-medium text-foreground/90">Why you might like this:</span> {currentRec.reason}
                  </p>
                )}
              </div>
            </div>

            {/* Next - desktop only */}
            <Button
              variant="default"
              size="lg"
              onClick={handleNext}
              disabled={currentIndex === totalRecs - 1}
              className="hidden md:flex shrink-0 self-center gap-2 min-w-[90px] justify-center py-5"
              data-testid="button-next"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Mobile nav buttons */}
          <div className="flex md:hidden items-center justify-center gap-3 w-full">
            <Button
              variant="default"
              size="default"
              onClick={handleBack}
              disabled={currentIndex === 0}
              className="gap-1.5"
              data-testid="button-back-mobile"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <span className="text-sm font-medium text-white">{currentIndex + 1} / {totalRecs}</span>
            <Button
              variant="default"
              size="default"
              onClick={handleNext}
              disabled={currentIndex === totalRecs - 1}
              className="gap-1.5"
              data-testid="button-next-mobile"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* CTA */}
          <div className="flex items-center justify-center gap-3 w-full py-2">
            <Link href="/">
              <Button
                size="lg"
                variant="default"
                className="gap-2"
                data-testid="button-try-whatwewatching"
              >
                <Film className="w-4 h-4" />
                Find Your Own Picks
              </Button>
            </Link>
          </div>

          {/* Poster thumbnails */}
          <div className="flex gap-2 w-full overflow-x-auto pb-2 justify-center flex-wrap">
            {recommendations.map((rec, i) => {
              const thumbUrl = rec.movie.posterPath
                ? rec.movie.posterPath.startsWith("http")
                  ? rec.movie.posterPath
                  : `https://image.tmdb.org/t/p/w154${rec.movie.posterPath}`
                : null;
              const isActive = i === currentIndex;
              return (
                <div key={rec.movie.tmdbId} className="flex flex-col items-center gap-1 shrink-0">
                  <span className={`text-base font-bold min-w-[1.5rem] text-center ${isActive ? "text-primary" : "text-white/80"}`}>
                    {i + 1}
                  </span>
                  <button
                    onClick={() => { setCurrentIndex(i); setAutoPlayTrailer(true); }}
                    className={`w-12 h-[72px] md:w-14 md:h-[84px] rounded-lg overflow-hidden border-2 transition-all ${
                      isActive
                        ? "border-primary ring-2 ring-primary/30 scale-105"
                        : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                    data-testid={`thumbnail-${i}`}
                  >
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={rec.movie.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        <Film className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
