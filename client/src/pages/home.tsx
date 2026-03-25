import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { StartSessionResponse, RoundPairResponse, ChoiceResponse, RecommendationsResponse } from "@shared/schema";
import { RoundPicker } from "@/components/round-picker";
import { ResultsScreen } from "@/components/results-screen";
import { PosterGridBackground } from "@/components/poster-grid-background";
import { GameInstructions } from "@/components/game-instructions";
import { AuthPromptModal } from "@/components/auth-prompt-modal";
import { Button } from "@/components/ui/button";
import { Film, Loader2, Bookmark, Mail, ChevronDown, ChevronUp, Users } from "lucide-react";
import { Footer } from "@/components/footer";
import { TestimonialsSection } from "@/components/testimonials";
import { HowToPlaySection } from "@/components/how-to-play";
import { FAQSection } from "@/components/faq-section";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

type GameState = "start" | "instructions" | "playing" | "loading-recommendations" | "results";

// Top 8 genres shown by default
const TOP_GENRE_IDS = ["action", "comedy", "drama", "thriller", "romance", "scifi", "family", "horror"];

// Individual genre options for precise matching
const MOOD_OPTIONS = [
  { id: "action", label: "Action", genres: ["Action"] },
  { id: "adventure", label: "Adventure", genres: ["Adventure"] },
  { id: "animation", label: "Animation", genres: ["Animation"] },
  { id: "comedy", label: "Comedy", genres: ["Comedy"] },
  { id: "crime", label: "Crime", genres: ["Crime"] },
  { id: "documentary", label: "Documentary", genres: ["Documentary"] },
  { id: "drama", label: "Drama", genres: ["Drama"] },
  { id: "family", label: "Family", genres: ["Family"] },
  { id: "fantasy", label: "Fantasy", genres: ["Fantasy"] },
  { id: "horror", label: "Horror", genres: ["Horror"] },
  { id: "indie", label: "Indie", genres: ["Indie"] }, // Special list-based filter
  { id: "mystery", label: "Mystery", genres: ["Mystery"] },
  { id: "romance", label: "Romance", genres: ["Romance"] },
  { id: "scifi", label: "Sci-Fi", genres: ["Sci-Fi"] },
  { id: "thriller", label: "Thriller", genres: ["Thriller"] },
  { id: "war", label: "War", genres: ["War"] },
  { id: "western", label: "Western", genres: ["Western"] },
  { id: "top", label: "Top Picks", genres: [] }, // Special case - top rated/popular
];

export default function Home() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const [gameState, setGameState] = useState<GameState>("start");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationsResponse | null>(null);
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [showMoreGenres, setShowMoreGenres] = useState(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const authPromptShownRef = useRef(false);
  const [, navigate] = useLocation();


  useEffect(() => {
    const saved = sessionStorage.getItem("homeState");
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as {
        gameState?: GameState;
        sessionId?: string | null;
        recommendations?: RecommendationsResponse | null;
        selectedMoods?: string[];
      };

      // Only restore states where we have meaningful data to show.
      // "instructions" is a transient step tied to a live server session — if the
      // server restarted (Render cold start / idle shutdown) the session is gone and
      // the user would be stuck. Always re-enter from "start" in that case.
      const restorableStates: GameState[] = ["playing", "loading-recommendations", "results"];
      if (parsed.gameState && restorableStates.includes(parsed.gameState)) {
        setGameState(parsed.gameState);
        setSessionId(parsed.sessionId ?? null);
        setRecommendations(parsed.recommendations ?? null);
        setSelectedMoods(parsed.selectedMoods ?? []);
      }
    } catch {
      // ignore corrupted state
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(
      "homeState",
      JSON.stringify({ gameState, sessionId, recommendations, selectedMoods })
    );
  }, [gameState, sessionId, recommendations, selectedMoods]);

  const toggleMood = useCallback((moodId: string) => {
    setSelectedMoods(prev => 
      prev.includes(moodId) 
        ? prev.filter(id => id !== moodId)
        : [...prev, moodId]
    );
  }, []);

  // Get all selected genres from moods
  const getSelectedGenres = useCallback(() => {
    const genres: string[] = [];
    for (const moodId of selectedMoods) {
      const mood = MOOD_OPTIONS.find(m => m.id === moodId);
      if (mood) {
        genres.push(...mood.genres);
      }
    }
    return genres;
  }, [selectedMoods]);

  // Start session mutation (pass { surpriseMe: true } for Surprise Me - empty genres)
  const startSessionMutation = useMutation({
    mutationFn: async (opts?: { surpriseMe?: boolean }) => {
      const surpriseMe = opts?.surpriseMe ?? false;
      const genres = surpriseMe ? [] : getSelectedGenres();
      const includeTopPicks = surpriseMe ? false : selectedMoods.includes("top");
      const res = await apiRequest("POST", "/api/session/start", { genres, includeTopPicks });
      return res.json() as Promise<StartSessionResponse>;
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setGameState("instructions");
    },
  });

  // Get current round query
  const roundQuery = useQuery<RoundPairResponse>({
    queryKey: ["/api/session", sessionId, "round"],
    queryFn: async () => {
      const res = await fetch(`/api/session/${sessionId}/round`);
      // Session expired (server restart / cold start) — reset cleanly to start screen
      if (res.status === 404) {
        sessionStorage.removeItem("homeState");
        setGameState("start");
        setSessionId(null);
        throw new Error("Session expired");
      }
      if (!res.ok) throw new Error("Failed to get round");
      return res.json();
    },
    enabled: gameState === "playing" && !!sessionId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Submit choice mutation
  const choiceMutation = useMutation({
    mutationFn: async (chosenMovieId: number) => {
      const res = await apiRequest("POST", `/api/session/${sessionId}/choose`, {
        chosenMovieId,
      });
      return res.json() as Promise<ChoiceResponse>;
    },
    onSuccess: async (data) => {
      if (data.isComplete) {
        setGameState("loading-recommendations");
        // Fetch recommendations
        try {
          const res = await fetch(`/api/session/${sessionId}/recommendations`);
          if (res.ok) {
            const recs = await res.json() as RecommendationsResponse;
            setRecommendations(recs);
          }
        } catch (error) {
          console.error("Failed to get recommendations:", error);
        }
        setGameState("results");
      } else {
        // Refetch to get next round
        roundQuery.refetch();
      }
    },
  });

  const handleStart = useCallback((surpriseMe = false) => {
    if (typeof window !== 'undefined' && window.posthog) {
      window.posthog.capture(surpriseMe ? "surprise_me" : "start_picking");
    }
    startSessionMutation.mutate(surpriseMe ? { surpriseMe: true } : undefined);
  }, [startSessionMutation]);

  const handleChoice = useCallback((chosenMovieId: number) => {
    choiceMutation.mutate(chosenMovieId);
  }, [choiceMutation]);

  // Skip round mutation (adds +1 round)
  const skipMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/session/${sessionId}/skip`);
      return res.json() as Promise<RoundPairResponse>;
    },
    onSuccess: () => {
      // Refetch to get the new pair
      roundQuery.refetch();
    },
  });

  const handleSkip = useCallback(() => {
    skipMutation.mutate();
  }, [skipMutation]);

  const handlePlayAgain = useCallback(() => {
    sessionStorage.removeItem("homeState");
    setSessionId(null);
    setRecommendations(null);
    setSelectedMoods([]);
    setGameState("start");
  }, []);

  const handleStartPlaying = useCallback(() => {
    setGameState("playing");
  }, []);

  // Show auth prompt once after the first completed voting flow if not signed in
  useEffect(() => {
    if (
      gameState === "results" &&
      !authLoading &&
      !user &&
      !authPromptShownRef.current
    ) {
      authPromptShownRef.current = true;
      setShowAuthPrompt(true);
    }
  }, [gameState, user, authLoading]);

  // Auto-dismiss the modal as soon as the user becomes authenticated
  useEffect(() => {
    if (user && showAuthPrompt) {
      setShowAuthPrompt(false);
    }
  }, [user, showAuthPrompt]);

  return (
    <div className="min-h-screen w-full flex flex-col">
      <PosterGridBackground hideLogos={gameState !== "start"} />
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
          <button 
            onClick={handlePlayAgain}
            className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -ml-2 transition-colors"
            data-testid="button-logo-home"
          >
            <img src="/logo.png" alt="WhatWeWatching" className="w-48 md:w-64 h-auto" />
          </button>
          <div className="flex items-center gap-1">
            <Link href="/contact">
              <Button variant="ghost" className="gap-2" data-testid="button-contact">
                <Mail className="w-4 h-4" />
                <span className="hidden sm:inline">Contact</span>
              </Button>
            </Link>

            {!authLoading && (
              user ? (
                // Signed-in: avatar + first name + dropdown
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(v => !v)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                    data-testid="button-user-menu"
                  >
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.displayName}
                        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center flex-shrink-0">
                        <span className="text-primary text-xs font-bold">
                          {user.displayName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <span className="hidden sm:inline text-sm text-white/80 font-medium">
                      {user.displayName.split(" ")[0]}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                  </button>

                  {showUserMenu && (
                    <>
                      {/* Backdrop to close on outside click */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowUserMenu(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-black/95 border border-white/10 rounded-lg py-1 shadow-xl">
                        <button
                          onClick={() => { setShowUserMenu(false); navigate("/watchlist?from=home"); }}
                          className="w-full text-left px-4 py-2.5 text-sm text-white/80 hover:text-white hover:bg-white/5 flex items-center gap-2 transition-colors"
                        >
                          <Bookmark className="w-4 h-4" />
                          My Watchlist
                        </button>
                        <div className="border-t border-white/5 my-1" />
                        <button
                          onClick={() => { setShowUserMenu(false); logout(); }}
                          className="w-full text-left px-4 py-2.5 text-sm text-white/50 hover:text-white/80 hover:bg-white/5 flex items-center gap-2 transition-colors"
                          data-testid="button-logout"
                        >
                          Sign Out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                // Signed-out: plain text link
                <button
                  onClick={login}
                  className="text-sm text-white/60 hover:text-white transition-colors px-2 py-1.5"
                  data-testid="button-google-login"
                >
                  Sign In
                </button>
              )
            )}
          </div>
        </div>
      </header>

      <main className={`relative z-10 flex-1 w-full max-w-7xl mx-auto px-2 sm:px-4 overflow-x-hidden overflow-y-auto min-h-0 ${(gameState === "loading-recommendations" || gameState === "results") ? "py-2 md:py-4" : "py-8"}`}>
        {gameState === "start" && (
          <div className="relative py-4 md:py-6">
            <div className="relative z-10 flex flex-col items-center gap-6 text-center w-full max-w-2xl mx-auto">

              {/* Headline — separate from interaction area */}
              <div className="px-5 py-5 rounded-xl w-full" style={{ background: 'rgba(0, 0, 0, 0.72)' }}>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white drop-shadow-lg leading-tight">
                  Stop searching. Start watching.
                </h2>
                <p className="text-sm sm:text-base text-white/80 font-medium mt-3 leading-snug">
                  Because choosing your movie shouldn&apos;t take longer than watching it.
                </p>
              </div>

              {/* Interaction card — visually distinct, breathing animation */}
              <div
                className="w-full rounded-2xl relative overflow-hidden"
                style={{
                  background: 'rgba(6, 0, 0, 0.88)',
                  animation: 'card-breathe 4s ease-in-out infinite',
                }}
              >
                {/* Top red accent line */}
                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/80 to-transparent" />

                <div className="p-5 md:p-7 flex flex-col items-center gap-5">

                  {/* Surprise Me — centred, ~1/3 width */}
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">Feeling lucky?</p>
                    <Button
                      size="lg"
                      onClick={() => handleStart(true)}
                      disabled={startSessionMutation.isPending}
                      className="surprise-pulse-btn min-w-[220px] px-10 h-14 text-base font-extrabold gap-2 border border-white/25 hover:-translate-y-1.5 hover:brightness-115 active:scale-95 transition-all duration-200"
                      data-testid="button-surprise-me"
                    >
                      {startSessionMutation.isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>🎲 Surprise Me</>
                      )}
                    </Button>
                  </div>

                  {/* Divider */}
                  <div className="flex items-center gap-3 w-full">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-[11px] text-white/65 font-semibold uppercase tracking-[0.18em]">or choose your mood</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>

                  {/* Genre grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full">
                    {MOOD_OPTIONS
                      .filter(m => showMoreGenres || TOP_GENRE_IDS.includes(m.id))
                      .map((mood) => {
                        const isSelected = selectedMoods.includes(mood.id);
                        return (
                          <Button
                            key={mood.id}
                            onClick={() => toggleMood(mood.id)}
                            variant={isSelected ? "default" : "outline"}
                            className={`h-11 text-sm font-medium transition-all duration-150 ${
                              isSelected
                                ? "bg-primary text-primary-foreground border-primary shadow-[0_0_14px_rgba(220,38,38,0.6)] scale-105"
                                : "bg-white/5 border-white/12 text-white/80 hover:bg-white/10 hover:border-white/35 hover:scale-[1.03]"
                            }`}
                            data-testid={`button-mood-${mood.id}`}
                          >
                            {mood.label}
                          </Button>
                        );
                      })}
                  </div>

                  <button
                    onClick={() => setShowMoreGenres(v => !v)}
                    className="flex items-center gap-1 text-xs text-white/65 hover:text-white/90 transition-colors"
                    data-testid="button-toggle-genres"
                  >
                    {showMoreGenres ? (
                      <><ChevronUp className="w-3.5 h-3.5" /> Fewer genres</>
                    ) : (
                      <><ChevronDown className="w-3.5 h-3.5" /> More genres ({MOOD_OPTIONS.length - TOP_GENRE_IDS.length} more)</>
                    )}
                  </button>

                  {/* Show My Picks — centred, ~1/3 width when active */}
                  <Button
                    size="lg"
                    onClick={() => handleStart(false)}
                    disabled={startSessionMutation.isPending || selectedMoods.length === 0}
                    className={`min-w-[220px] px-10 h-14 text-base font-bold gap-2 transition-all duration-200 ${
                      selectedMoods.length === 0
                        ? "w-full opacity-60 cursor-not-allowed bg-white/5 border border-white/10 text-white/65"
                        : "shadow-[0_0_24px_rgba(220,38,38,0.45)] hover:-translate-y-1 active:scale-95"
                    }`}
                    data-testid="button-start-game"
                  >
                    {startSessionMutation.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : selectedMoods.length === 0 ? (
                      <span className="text-sm">Choose at least one genre above</span>
                    ) : (
                      <>
                        <Film className="w-4 h-4" />
                        Show My Picks ({selectedMoods.length})
                      </>
                    )}
                  </Button>

                </div>

                {/* Bottom accent line */}
                <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
              </div>

              {startSessionMutation.isError && (
                <p className="text-destructive bg-black/50 px-4 py-2 rounded text-sm">
                  Movies are still loading. Please wait a moment and try again.
                </p>
              )}

              {/* Testimonials */}
              <TestimonialsSection />

              {/* User counter — below testimonials */}
              <div className="flex items-center justify-center gap-2.5 px-5 py-3 rounded-full bg-black/50 border border-white/10">
                <Users className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm text-white/70">
                  <span className="font-bold text-white text-base">43,000+</span> Australians have used WhatWeWatching
                </span>
              </div>
            </div>

            {/* How to Play — full width marquee */}
            <HowToPlaySection />

            {/* FAQ — centred, max-w-2xl */}
            <FAQSection />
          </div>
        )}

        {gameState === "instructions" && (
          <GameInstructions onStart={handleStartPlaying} />
        )}

        {gameState === "playing" && roundQuery.data && !roundQuery.data.isComplete && (
          <RoundPicker
            round={roundQuery.data.round}
            totalRounds={roundQuery.data.totalRounds}
            baseTotalRounds={roundQuery.data.baseTotalRounds}
            choicesMade={roundQuery.data.choicesMade}
            leftMovie={roundQuery.data.leftMovie}
            rightMovie={roundQuery.data.rightMovie}
            onChoice={handleChoice}
            onSkip={handleSkip}
            isSubmitting={choiceMutation.isPending}
            isSkipping={skipMutation.isPending}
            choiceHistory={roundQuery.data.choiceHistory}
            selectedGenres={selectedMoods.map(id => MOOD_OPTIONS.find(m => m.id === id)?.label).filter(Boolean) as string[]}
          />
        )}

        {gameState === "playing" && roundQuery.isLoading && (
          <div className="flex flex-col items-center justify-center gap-4 min-h-[60vh]">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading next round...</p>
          </div>
        )}

        {gameState === "playing" && roundQuery.isError && (
          <div className="flex flex-col items-center justify-center gap-4 min-h-[60vh]">
            <p className="text-muted-foreground">Failed to load round. Please try again.</p>
            <Button onClick={() => roundQuery.refetch()} data-testid="button-retry-round">
              Retry
            </Button>
          </div>
        )}

        {(gameState === "loading-recommendations" || gameState === "results") && (
          <ResultsScreen
            recommendations={recommendations}
            isLoading={gameState === "loading-recommendations"}
            onPlayAgain={handlePlayAgain}
            sessionId={sessionId}
          />
        )}
      </main>
      <Footer />

      {showAuthPrompt && (
        <AuthPromptModal onSkip={() => setShowAuthPrompt(false)} />
      )}
    </div>
  );
}
