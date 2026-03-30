import type {
  RecommendationsResponse,
  WatchProvidersResponse,
  Recommendation,
  TastePreview,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Play,
  RefreshCw,
  Film,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  Tv,
  Eye,
  EyeOff,
  Share2,
  Check,
} from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { ShareCard } from "./share-card";
import { AuthPromptModal } from "./auth-prompt-modal";
import { SignUpNudge } from "./signup-nudge";
import { useAuth } from "@/contexts/AuthContext";
import {
  appendShownRecommendations,
  buildAnonMemoryHeaders,
  fingerprintAnonPayload,
  getAnonMemoryPayloadForSession,
} from "@/lib/anonymous-rec-memory";

function tasteHeadline(profile: RecommendationsResponse["preferenceProfile"] | undefined): string {
  const h = profile?.headline?.trim();
  if (h) return h;
  const g = profile?.topGenres?.filter(Boolean) ?? [];
  if (g.length >= 2) return `Tonight: ${g[0].toLowerCase()} with a ${g[1].toLowerCase()} edge.`;
  if (g.length === 1) return `Tonight leans ${g[0].toLowerCase()}.`;
  return "Here’s what matched your picks.";
}

/** Display-only: shift common third-person / label phrasing to second-person for results copy. */
function supportCopyYouVoice(summary: string): string {
  let s = summary.trim();
  if (!s) return s;
  if (/leaning toward:/i.test(s) || /steering clear of:/i.test(s)) {
    s = s.replace(/\s*steering clear of:\s*/gi, " You want to avoid ");
    s = s.replace(/^leaning toward:\s*/i, "You're looking for ");
    s = s.replace(/\.\s*leaning toward:\s*/gi, ". You're looking for ");
  } else {
    s = s
      .replace(/^they are /i, "You're ")
      .replace(/^they're /i, "You're ")
      .replace(/^they want /i, "You want ")
      .replace(/^they prefer /i, "You prefer ")
      .replace(/^they /i, "You ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function loadingHeadlineFromPreview(p: TastePreview | undefined): string {
  const h = p?.headline?.trim();
  if (h) return h;
  const g = p?.topGenres?.filter(Boolean) ?? [];
  if (g.length >= 2) return `${g[0]} · ${g[1]}`;
  if (g.length === 1) return g[0];
  return "Your mood tonight";
}

function loadingBodyFromPreview(p: TastePreview | undefined): string {
  const raw = p?.patternSummary?.trim() ?? "";
  if (raw) return supportCopyYouVoice(raw);
  return "We’re lining up films that match how you voted.";
}

interface ResultsScreenProps {
  recommendations: RecommendationsResponse | null;
  isLoading: boolean;
  loadingVariant?: "fullscreen" | "inline";
  loadError?: boolean;
  onPlayAgain: () => void;
  sessionId?: string | null;
  suppressTrailer?: boolean; // hide iframe when an overlay modal is open (YouTube z-index fix)
}

export function ResultsScreen({
  recommendations,
  isLoading,
  loadingVariant = "fullscreen",
  loadError = false,
  onPlayAgain,
  sessionId,
  suppressTrailer = false,
}: ResultsScreenProps) {
  const { user } = useAuth();
  const [authModal, setAuthModal] = useState<{ heading: string; triggerSource: string } | null>(null);
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
  const [hasInteracted, setHasInteracted] = useState(false); // Track if user has clicked anything
  const { toast } = useToast();
  /** Dedupes recommendation_served if this effect runs twice (e.g. React Strict Mode) */
  const recommendationServedKeyRef = useRef<string | null>(null);

  // Track when results screen loads with recommendations
  useEffect(() => {
    if (!isLoading && recommendations) {
      if (typeof window !== 'undefined' && window.posthog) {
        window.posthog.capture("completed_flow");
      }
      if (!user) {
        const since = parseInt(sessionStorage.getItem("signup_nudge_flows_since") ?? "0", 10) + 1;
        sessionStorage.setItem("signup_nudge_flows_since", String(since));
      }
    }
  }, [isLoading, recommendations, user]);

  // Reset trailer state when changing movies
  useEffect(() => {
    setTrailerIndex(0);
    setAllTrailersFailed(false);
  }, [currentIndex]);

  // Smooth progress bar while recommendations load (indeterminate feel; caps at ~92% until data arrives).
  useEffect(() => {
    if (!isLoading) {
      setLoadingProgress(0);
      return;
    }

    const start = Date.now();
    const durationMs = 8000;
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const p = Math.min(92, (elapsed / durationMs) * 100);
      setLoadingProgress(p);
    }, 100);

    return () => clearInterval(progressInterval);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading && recommendations) {
      setLoadingProgress(100);
    }
  }, [isLoading, recommendations]);

  const tasteAnonPayload = useMemo(
    () => (sessionId ? getAnonMemoryPayloadForSession(sessionId) : []),
    [sessionId]
  );
  const tasteAnonFp = useMemo(() => fingerprintAnonPayload(tasteAnonPayload), [tasteAnonPayload]);

  const { data: tastePreview } = useQuery<TastePreview>({
    queryKey: ["/api/session", sessionId, "taste-preview", tasteAnonFp],
    queryFn: async () => {
      const headers = buildAnonMemoryHeaders(tasteAnonPayload) as Record<string, string>;
      const res = await fetch(`/api/session/${sessionId}/taste-preview`, { headers });
      if (!res.ok) throw new Error("Failed to load taste preview");
      return (await res.json()) as TastePreview;
    },
    enabled: !!sessionId && isLoading,
    retry: 1,
    staleTime: 60_000,
  });

  // Initialize local recs from recommendations
  useEffect(() => {
    if (recommendations?.recommendations) {
      setLocalRecs([...recommendations.recommendations]);
    }
  }, [recommendations]);

  useEffect(() => {
    if (isLoading || !recommendations?.recommendations?.length || user) return;
    appendShownRecommendations(recommendations.recommendations);
  }, [isLoading, recommendations, user]);

  // Mutation to get a replacement recommendation
  const replacementMutation = useMutation({
    mutationFn: async (vars: { excludeTmdbIds: number[] }) => {
      const payload = sessionId ? getAnonMemoryPayloadForSession(sessionId) : [];
      const extra = buildAnonMemoryHeaders(payload) as Record<string, string>;
      const res = await apiRequest(
        "POST",
        `/api/session/${sessionId}/replacement`,
        {
          excludeTmdbIds: vars.excludeTmdbIds,
        },
        { headers: extra }
      );
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

  /** Keep seen titles in the row so the Seen control can toggle off; dim in UI instead of removing. */
  const displayRecs = localRecs;
  const currentRec = displayRecs[currentIndex];
  const currentTmdbId = currentRec?.movie.tmdbId;

  // Track wildcard badge shown when current rec changes
  useEffect(() => {
    if (currentRec?.wildcardBadge && typeof window !== "undefined" && window.posthog) {
      window.posthog.capture("wildcard_pick_shown", {
        tmdb_id: currentRec.movie.tmdbId,
        title: currentRec.movie.title,
      });
    }
  }, [currentRec?.movie.tmdbId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Track personalised results served (fires once when results load)
  useEffect(() => {
    if (
      recommendations &&
      (recommendations as any).hasPersonalisation &&
      typeof window !== "undefined" &&
      window.posthog
    ) {
      window.posthog.capture("personalised_results_served", {
        genre_profile_size: (recommendations as any).genreProfileSize ?? 0,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!(recommendations as any)?.hasPersonalisation]);

  // Per-movie analytics: one batch per initial recommendations payload (not personalised_results_served)
  useEffect(() => {
    if (
      isLoading ||
      !recommendations?.recommendations?.length ||
      !sessionId ||
      typeof window === "undefined" ||
      !window.posthog
    ) {
      return;
    }
    const list = recommendations.recommendations;
    const dedupeKey = `${sessionId}:${list.map((r) => r.movie.id).join(",")}`;
    if (recommendationServedKeyRef.current === dedupeKey) return;
    recommendationServedKeyRef.current = dedupeKey;
    list.forEach((rec, i) => {
      window.posthog!.capture("recommendation_served", {
        movie_id: rec.movie.id,
        title: rec.movie.title,
        genres: rec.movie.genres ?? [],
        position: i + 1,
        session_id: sessionId,
      });
    });
  }, [isLoading, recommendations, sessionId]);

  const { data: watchProviders, isLoading: isLoadingProviders } = useQuery<WatchProvidersResponse>({
    queryKey: [
      "/api/watch-providers",
      currentTmdbId,
      currentRec?.movie.title ?? "",
      currentRec?.movie.year ?? "",
    ],
    queryFn: async () => {
      const title = currentRec?.movie.title ?? "";
      const year = currentRec?.movie.year ?? "";
      const q = new URLSearchParams({ title, year: String(year) });
      const res = await fetch(`/api/watch-providers/${currentTmdbId}?${q.toString()}`);
      if (!res.ok) throw new Error("Failed to load providers");
      return res.json() as Promise<WatchProvidersResponse>;
    },
    enabled: showWatchProviders && !!currentTmdbId && !!currentRec,
  });

  /** Seen toggle: on → mark + request replacement once; off → clear mark (no second API). */
  const handleSeenToggle = () => {
    if (!currentRec || !sessionId) return;
    const tmdbId = currentRec.movie.tmdbId;
    if (seenMovies.has(tmdbId)) {
      setSeenMovies((prev) => {
        const n = new Set(prev);
        n.delete(tmdbId);
        return n;
      });
      setAutoPlayTrailer(true);
      return;
    }
    setSeenMovies((prev) => new Set(prev).add(tmdbId));
    const allExcludedIds = [
      ...Array.from(seenMovies),
      tmdbId,
      ...localRecs.map((r) => r.movie.tmdbId),
    ];
    replacementMutation.mutate({
      excludeTmdbIds: allExcludedIds,
    });
    setAutoPlayTrailer(true);
  };

  const addToWatchlistMutation = useMutation({
    mutationFn: async (movie: { tmdbId: number; title: string; year: number | null; posterPath: string | null; genres: string[]; rating: number | null }) => {
      const res = await apiRequest("POST", "/api/watchlist", {
        tmdbId: movie.tmdbId,
        title: movie.title,
        posterPath: movie.posterPath,
        releaseYear: movie.year,
        genres: movie.genres,
      });
      return res.json();
    },
    onSuccess: (_data, movie) => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      if (typeof window !== "undefined" && window.posthog) {
        window.posthog.capture("watchlist_saved", {
          tmdb_id: movie.tmdbId,
          title: movie.title,
          genres: movie.genres,
          source: "results",
        });
      }
      toast({
        title: "Saved to watchlist ✓",
        description: "Movie saved to your watchlist!",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't save",
        description: "Failed to add to watchlist. Please try again.",
        variant: "destructive",
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
      setAutoPlayTrailer(false); // pause trailer while share card is open
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

  if (loadError && !recommendations) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 px-4 max-w-md mx-auto text-center">
        <p className="text-white/90">Couldn&apos;t load recommendations.</p>
        <Button size="lg" onClick={onPlayAgain} data-testid="button-retry-recs">
          <RefreshCw className="w-4 h-4 mr-2" />
          Try again
        </Button>
      </div>
    );
  }

  const loadingMoodHeadline = loadingHeadlineFromPreview(tastePreview);
  const loadingMoodBody = loadingBodyFromPreview(tastePreview);

  const loadingProgressBar = (
    <div className="w-full max-w-md mx-auto bg-white/15 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-primary via-primary/85 to-primary/70 rounded-full transition-all duration-300 ease-out"
        style={{ width: `${loadingProgress}%` }}
      />
    </div>
  );

  if (isLoading && !recommendations && loadingVariant === "inline") {
    return (
      <div
        className="w-full max-w-2xl mx-auto px-4 py-10 md:py-14 flex flex-col items-center text-center gap-6"
        data-testid="loading-recommendations-inline"
      >
        <div className="space-y-3 md:space-y-4 max-w-lg">
          <h2 className="text-xl md:text-3xl lg:text-4xl font-bold text-white uppercase tracking-[0.08em] leading-tight">
            {loadingMoodHeadline}
          </h2>
          <p className="text-sm md:text-base text-white/70 leading-relaxed">{loadingMoodBody}</p>
          <p className="text-xs md:text-sm text-white/50 pt-1">
            While we fetch your tailored picks for tonight…
          </p>
        </div>
        {loadingProgressBar}
        <p className="text-[11px] md:text-xs text-white/40">This usually only takes a moment.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-8 min-h-[60vh] px-4"
        data-testid="loading-recommendations"
      >
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-black/50 backdrop-blur-md px-6 py-10 md:px-10 md:py-12 flex flex-col items-center gap-6">
          <div className="space-y-3 md:space-y-4 text-center w-full">
            <h2 className="text-xl md:text-3xl font-bold text-white uppercase tracking-[0.08em] leading-tight">
              {loadingMoodHeadline}
            </h2>
            <p className="text-sm md:text-base text-white/70 leading-relaxed">{loadingMoodBody}</p>
            <p className="text-xs md:text-sm text-white/50">
              While we fetch your tailored picks for tonight…
            </p>
          </div>
          {loadingProgressBar}
          <p className="text-[11px] text-white/40 text-center">This usually only takes a moment.</p>
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

  const { preferenceProfile, hasPersonalisation } = recommendations;
  const totalRecs = displayRecs.length;
  const profileLine = preferenceProfile?.headline?.trim() ?? "";
  const headline = profileLine || tasteHeadline(preferenceProfile);
  const patternSummary =
    preferenceProfile?.patternSummary?.trim() || preferenceProfile?.tagline?.trim();
  const profileOnly = !patternSummary;
  const isCurrentSeen = currentRec ? seenMovies.has(currentRec.movie.tmdbId) : false;

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
    if (!user) {
      setAuthModal({ heading: "Save your picks & build your taste profile", triggerSource: "watchlist" });
      return;
    }
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

  const primaryProvider =
    watchProviders?.providers?.find((p) => p.type === "subscription") ??
    watchProviders?.providers?.[0];
  const hasAuWatchFlag = currentRec?.auWatchAvailable !== false;
  const watchNowLabel = user
    ? primaryProvider
      ? `Watch now on ${primaryProvider.name}`
      : "Stream or rent in AU"
    : "Where to Watch";

  return (
    <div className="flex flex-col items-center gap-1 md:gap-2 w-full max-w-7xl mx-auto px-2 md:px-4 pt-4 md:pt-2 pb-4 md:pb-6">
      {/* Profile line (LLM) + optional longer taste copy */}
      <div className="text-center max-w-xl md:max-w-3xl px-3 pt-1 pb-2">
        <h2
          className={
            profileLine
              ? "text-xl md:text-2xl lg:text-3xl font-semibold text-white tracking-tight leading-snug normal-case"
              : profileOnly
                ? "text-xl md:text-2xl lg:text-3xl font-semibold text-white tracking-tight leading-snug"
                : "text-2xl md:text-4xl lg:text-[2.75rem] font-bold text-white uppercase tracking-[0.06em] leading-[1.15]"
          }
        >
          {headline}
        </h2>
        {patternSummary && (
          <p
            className="text-sm md:text-base text-white/65 mt-3 md:mt-4 leading-relaxed max-w-2xl mx-auto"
            data-testid="taste-profile"
          >
            {supportCopyYouVoice(patternSummary)}
          </p>
        )}
      </div>

      {/* Personalisation indicator — only visible for logged-in users with history */}
      {hasPersonalisation && (
        <p className="text-xs text-white/30 text-center" data-testid="personalisation-label">
          Based on your taste profile
        </p>
      )}

      {/* Trailer card with nav - row on desktop, stacked on mobile */}
      <div className="flex flex-col md:flex-row md:items-stretch gap-2 md:gap-3 w-full max-w-7xl mt-1">
        {/* Previous - hidden on mobile, shown beside card on desktop */}
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
          className={`w-full md:flex-1 md:min-w-0 bg-card/50 border border-border/50 rounded-xl md:rounded-2xl overflow-hidden backdrop-blur-sm transition-opacity duration-300 ${
            isCurrentSeen ? "opacity-55" : ""
          }`}
          data-testid={`recommendation-card-${currentIndex}`}
        >
          {/* Trailer - 16:9 */}
          <div className="aspect-video w-full relative">
            {(() => {
              const availableTrailers = currentRec.trailerUrls?.length 
                ? currentRec.trailerUrls 
                : currentRec.trailerUrl 
                  ? [currentRec.trailerUrl] 
                  : [];
              
              const currentTrailerUrl = availableTrailers[trailerIndex];
              const hasMoreTrailers = trailerIndex < availableTrailers.length - 1;
              
              const handleTrailerError = () => {
                if (hasMoreTrailers) {
                  setTrailerIndex(prev => prev + 1);
                } else {
                  setAllTrailersFailed(true);
                }
              };
              
              if (currentTrailerUrl && autoPlayTrailer && !allTrailersFailed && !suppressTrailer && !authModal) {
                const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                const muteParam = (isMobile && !hasInteracted) ? 1 : 0;
                
                return (
                  <div className="relative w-full h-full">
                    <iframe
                      key={currentTrailerUrl}
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
                {currentRec.wildcardBadge && (
                  <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0 text-xs" data-testid="wildcard-badge">
                    ✦ {currentRec.wildcardBadge}
                  </Badge>
                )}
              </div>
              {hasAuWatchFlag ? (
                <Button
                  variant="default"
                  size="lg"
                  onClick={() => {
                    if (!user) {
                      setAuthModal({
                        heading: "Sign in to track what you watch and get better picks next time",
                        triggerSource: "where_to_watch",
                      });
                      return;
                    }
                    setShowWatchProviders(true);
                  }}
                  className="gap-2 shrink-0 w-full md:w-auto font-semibold"
                  data-testid="button-watch-now"
                >
                  <Tv className="w-4 h-4" />
                  {watchNowLabel}
                </Button>
              ) : null}
            </div>
            {currentRec.reason?.trim() ? (
              <p className="text-foreground/75 text-sm leading-snug mt-2 max-w-prose" data-testid="text-movie-reason">
                <span className="font-medium text-foreground/90">Why this fits your picks:</span>{" "}
                {currentRec.reason}
              </p>
            ) : null}
          </div>
        </div>

        {/* Next - hidden on mobile, shown beside card on desktop */}
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

      {/* Mobile nav buttons - shown below card on mobile only */}
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
        <span className="text-sm font-medium text-foreground">{currentIndex + 1} / {totalRecs}</span>
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

      {/* Save, Seen, Share — compact glass pills */}
      <div className="flex items-center justify-center gap-2 w-full flex-wrap py-3">
        <button
          type="button"
          onClick={handleLike}
          className={`
            inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold
            border backdrop-blur-md transition-all duration-200
            hover:scale-[1.04] hover:shadow-[0_0_20px_rgba(255,255,255,0.12)] active:scale-[0.97]
            ${
              isLiked
                ? "bg-emerald-500/90 text-white border-emerald-400/50 shadow-[0_0_16px_rgba(16,185,129,0.35)]"
                : "bg-black/45 text-white/90 border-white/15 hover:border-white/30 hover:bg-black/55"
            }
          `}
          data-testid="button-save-watchlist"
        >
          <Bookmark className={`w-3.5 h-3.5 ${isLiked ? "fill-current" : ""}`} />
          Save
        </button>

        <button
          type="button"
          onClick={handleSeenToggle}
          disabled={replacementMutation.isPending || !sessionId}
          className={`
            inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold
            border backdrop-blur-md transition-all duration-200
            hover:scale-[1.04] hover:shadow-[0_0_20px_rgba(251,191,36,0.15)] active:scale-[0.97]
            disabled:opacity-50 disabled:pointer-events-none
            ${
              isCurrentSeen || replacementMutation.isPending
                ? "bg-amber-500/25 text-amber-100 border-amber-400/40 shadow-[0_0_14px_rgba(245,158,11,0.25)]"
                : "bg-black/45 text-white/90 border-white/15 hover:border-amber-400/35 hover:bg-amber-500/10"
            }
          `}
          data-testid="button-seen-it"
        >
          {replacementMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isCurrentSeen ? (
            <EyeOff className="w-3.5 h-3.5" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
          Seen
        </button>

        <button
          type="button"
          onClick={() => shareMutation.mutate()}
          disabled={shareMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold
            border border-white/15 bg-black/45 text-white/90 backdrop-blur-md
            transition-all duration-200 hover:scale-[1.04] hover:border-white/28 hover:bg-black/55
            hover:shadow-[0_0_18px_rgba(255,255,255,0.08)] active:scale-[0.97]
            disabled:opacity-50"
          data-testid="button-share"
        >
          {shareMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Share2 className="w-3.5 h-3.5" />
          )}
          Share
        </button>

      </div>

      <div className="flex flex-col gap-2 w-full max-w-5xl mx-auto pb-2">
        <div className="flex gap-2 w-full overflow-x-auto justify-center flex-wrap md:flex-nowrap">
          {displayRecs.map((rec, i) => {
            const thumbUrl = rec.movie.posterPath
              ? rec.movie.posterPath.startsWith("http")
                ? rec.movie.posterPath
                : `https://image.tmdb.org/t/p/w154${rec.movie.posterPath}`
              : null;
            const isActive = i === currentIndex;
            const isSeenThumb = seenMovies.has(rec.movie.tmdbId);
            return (
              <div key={rec.movie.tmdbId} className="flex flex-col items-center gap-1 shrink-0">
                <span
                  className={`text-sm font-bold min-w-[1.25rem] text-center ${
                    isActive ? "text-primary" : "text-foreground/80"
                  }`}
                >
                  {i + 1}
                </span>
                <button
                  onClick={() => {
                    setCurrentIndex(i);
                    setAutoPlayTrailer(true);
                  }}
                  className={`w-12 h-[72px] md:w-14 md:h-[84px] rounded-lg overflow-hidden border-2 transition-all ${
                    isActive
                      ? "border-primary ring-2 ring-primary/30 scale-105"
                      : "border-transparent opacity-70 hover:opacity-100"
                  } ${isSeenThumb ? "opacity-45 grayscale" : ""}`}
                  data-testid={`thumbnail-${i}`}
                  type="button"
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

      {/* Watch Providers Dialog */}
      <Dialog open={showWatchProviders} onOpenChange={setShowWatchProviders}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tv className="w-5 h-5 text-primary" />
              Where to Watch
            </DialogTitle>
            <p className="text-sm text-muted-foreground">Opens in a new tab</p>
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
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.preventDefault();
                            if (window.posthog) {
                              window.posthog.capture('provider_click', {
                                provider: provider.name,
                                provider_type: 'subscription',
                                movie_title: currentRec?.movie.title,
                                movie_id: currentRec?.movie.tmdbId,
                                position: currentIndex,
                                source: 'results',
                              });
                            }
                            window.open(provider.deepLink || '#', '_blank', 'noopener,noreferrer');
                          }}
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
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.preventDefault();
                            if (window.posthog) {
                              window.posthog.capture('provider_click', {
                                provider: provider.name,
                                provider_type: 'rent',
                                movie_title: currentRec?.movie.title,
                                movie_id: currentRec?.movie.tmdbId,
                                position: currentIndex,
                                source: 'results',
                              });
                            }
                            window.open(provider.deepLink || '#', '_blank', 'noopener,noreferrer');
                          }}
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
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.preventDefault();
                            if (window.posthog) {
                              window.posthog.capture('provider_click', {
                                provider: provider.name,
                                provider_type: 'buy',
                                movie_title: currentRec?.movie.title,
                                movie_id: currentRec?.movie.tmdbId,
                                position: currentIndex,
                                source: 'results',
                              });
                            }
                            window.open(provider.deepLink || '#', '_blank', 'noopener,noreferrer');
                          }}
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
          {/* Sticky close button — always reachable on mobile */}
          <div className="pt-2 pb-1">
            <DialogClose asChild>
              <Button variant="outline" className="w-full" data-testid="button-close-providers">
                ← Back to Trailers
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Share Card Modal */}
      {recommendations && (
        <ShareCard
          isOpen={showShareCard}
          onClose={() => { setShowShareCard(false); setAutoPlayTrailer(true); }}
          recommendations={displayRecs}
          preferenceProfile={recommendations.preferenceProfile}
          shareUrl={shareUrl || undefined}
        />
      )}

      {authModal && (
        <AuthPromptModal
          heading={authModal.heading}
          triggerSource={authModal.triggerSource}
          onSkip={() => setAuthModal(null)}
        />
      )}

      {/* Post-recommendation sign-up nudge — soft bottom sheet, shown after 2s for logged-out users */}
      {!user && !isLoading && recommendations && (
        <SignUpNudge movieTitle={currentRec?.movie.title} />
      )}
    </div>
  );
}
