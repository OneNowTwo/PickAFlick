import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { StartSessionResponse, RoundPairResponse, ChoiceResponse, RecommendationsResponse } from "@shared/schema";
import { RoundPicker } from "@/components/round-picker";
import { ResultsScreen } from "@/components/results-screen";
import { PosterGridBackground } from "@/components/poster-grid-background";
import { GameInstructions } from "@/components/game-instructions";
import { Button } from "@/components/ui/button";
import { Film, Loader2, Bookmark, Mail } from "lucide-react";
import { Footer } from "@/components/footer";
import { Link } from "wouter";

type GameState = "start" | "instructions" | "playing" | "loading-recommendations" | "results";

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
  const [gameState, setGameState] = useState<GameState>("start");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationsResponse | null>(null);
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);


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

      if (parsed.gameState && parsed.gameState !== "start") {
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

  return (
    <div className="min-h-screen w-full flex flex-col">
      <PosterGridBackground />
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
          <button 
            onClick={handlePlayAgain}
            className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -ml-2 transition-colors"
            data-testid="button-logo-home"
          >
            <img src="/logo.png" alt="WhatWeWatching" className="w-48 md:w-64 h-auto" />
          </button>
          <div className="flex items-center gap-2">
            <Link href="/contact">
              <Button variant="ghost" className="gap-2" data-testid="button-contact">
                <Mail className="w-4 h-4" />
                <span className="hidden sm:inline">Contact</span>
              </Button>
            </Link>
            <Link href="/watchlist?from=home">
              <Button variant="ghost" className="gap-2" data-testid="button-watchlist">
                <Bookmark className="w-4 h-4" />
                <span className="hidden sm:inline">My Watchlist</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className={`relative z-10 flex-1 w-full max-w-7xl mx-auto px-2 sm:px-4 overflow-x-hidden overflow-y-auto min-h-0 ${(gameState === "loading-recommendations" || gameState === "results") ? "py-2 md:py-4" : "py-8"}`}>
        {gameState === "start" && (
          <div className="relative min-h-[70vh] flex items-center justify-center">
            <div className="relative z-10 flex flex-col items-center justify-center gap-6 text-center max-w-3xl mx-auto w-full">
              <div className="space-y-3 p-6 md:p-8 rounded-lg" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
                <h2 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">
                  Find Your Perfect Movie
                </h2>
                <p className="text-lg text-gray-300 italic max-w-md mx-auto drop-shadow-md">
                  &quot;Because choosing your movie shouldn&apos;t take longer than watching it.&quot;
                </p>
              </div>

              {/* Mood Selection - Clear tappable buttons */}
              <div className="p-4 sm:p-6 rounded-lg w-full max-w-full" style={{ background: 'rgba(0, 0, 0, 0.6)' }}>
                <h3 className="text-xl font-bold text-white mb-1">Tap Your Mood</h3>
                <p className="text-gray-400 text-sm mb-4">Pick one or more genres, or Surprise Me for everything</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 w-full">
                  {MOOD_OPTIONS.map((mood) => (
                    <Button
                      key={mood.id}
                      onClick={() => toggleMood(mood.id)}
                      variant={selectedMoods.includes(mood.id) ? "default" : "outline"}
                      className={`h-12 md:h-14 text-sm md:text-base font-medium transition-all ${
                        selectedMoods.includes(mood.id)
                          ? "bg-primary text-primary-foreground border-primary ring-2 ring-primary/50"
                          : "bg-black/40 border-white/20 text-white hover:bg-white/10 hover:border-white/40"
                      }`}
                      data-testid={`button-mood-${mood.id}`}
                    >
                      {mood.label}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  onClick={() => handleStart(true)}
                  disabled={startSessionMutation.isPending}
                  className="mt-4 w-full h-11 bg-white/10 border-white/30 text-white hover:bg-white/20 hover:border-white/50 font-medium"
                  data-testid="button-surprise-me"
                >
                  {startSessionMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Surprise Me"
                  )}
                </Button>
              </div>

              <Button
                size="lg"
                onClick={() => handleStart(false)}
                disabled={startSessionMutation.isPending || selectedMoods.length === 0}
                className={`text-lg px-10 py-6 font-bold shadow-lg min-w-[200px] transition-all ${
                  selectedMoods.length === 0
                    ? "opacity-50 cursor-not-allowed bg-muted-foreground/30"
                    : "shadow-primary/25"
                }`}
                data-testid="button-start-game"
              >
                {startSessionMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Film className="w-5 h-5 mr-2" />
                    Start Picking
                  </>
                )}
              </Button>

              {startSessionMutation.isError && (
                <p className="text-destructive bg-black/50 px-4 py-2 rounded">
                  Movies are still loading. Please wait a moment and try again.
                </p>
              )}
            </div>
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
    </div>
  );
}
