import type { RecommendationsResponse } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RefreshCw, Film, Palette, Heart, Calendar, Sparkles, ChevronLeft, ChevronRight, ThumbsUp, Bookmark } from "lucide-react";
import { useState } from "react";

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
    const movieId = currentRec.movie.id;
    const newLiked = new Set(likedMovies);
    if (newLiked.has(movieId)) {
      newLiked.delete(movieId);
    } else {
      newLiked.add(movieId);
      maybeMovies.delete(movieId);
      setMaybeMovies(new Set(maybeMovies));
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
              src={`${currentRec.trailerUrl}?autoplay=1&mute=1`}
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
      <div className="flex items-center justify-center gap-3 w-full max-w-md">
        <Button
          variant="outline"
          size="icon"
          onClick={handleBack}
          disabled={currentIndex === 0}
          data-testid="button-back"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

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

        <Button
          variant="outline"
          size="icon"
          onClick={handleNext}
          disabled={currentIndex === totalRecs - 1}
          data-testid="button-next"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
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
    </div>
  );
}
