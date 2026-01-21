import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { StartSessionResponse, RoundPairResponse, ChoiceResponse, RecommendationsResponse } from "@shared/schema";
import { RoundPicker } from "@/components/round-picker";
import { ResultsScreen } from "@/components/results-screen";
import { PosterGridBackground } from "@/components/poster-grid-background";
import { Button } from "@/components/ui/button";
import { Clapperboard, Loader2, Bookmark } from "lucide-react";
import { Link } from "wouter";

type GameState = "start" | "playing" | "loading-recommendations" | "results";

export default function Home() {
  const [gameState, setGameState] = useState<GameState>("start");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationsResponse | null>(null);

  // Start session mutation
  const startSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/session/start");
      return res.json() as Promise<StartSessionResponse>;
    },
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setGameState("playing");
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

  const handleStart = useCallback(() => {
    startSessionMutation.mutate();
  }, [startSessionMutation]);

  const handleChoice = useCallback((chosenMovieId: number) => {
    choiceMutation.mutate(chosenMovieId);
  }, [choiceMutation]);

  const handlePlayAgain = useCallback(() => {
    setSessionId(null);
    setRecommendations(null);
    setGameState("start");
  }, []);

  return (
    <div className="min-h-screen bg-background w-full">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
          <button 
            onClick={handlePlayAgain}
            className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -ml-2 transition-colors"
            data-testid="button-logo-home"
          >
            <Clapperboard className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">PickAFlick</h1>
          </button>
          <Link href="/watchlist">
            <Button variant="ghost" className="gap-2" data-testid="button-watchlist">
              <Bookmark className="w-4 h-4" />
              <span className="hidden sm:inline">My Watchlist</span>
            </Button>
          </Link>
        </div>
      </header>

      <main className="w-full max-w-7xl mx-auto py-8 px-4">
        {gameState === "start" && (
          <div className="relative min-h-[70vh] flex items-center justify-center">
            <PosterGridBackground />
            <div className="relative z-10 flex flex-col items-center justify-center gap-8 text-center">
              <div className="space-y-4">
                <h2 className="text-4xl md:text-5xl font-bold text-foreground">
                  Find Your Perfect Movie
                </h2>
                <p className="text-xl text-muted-foreground max-w-lg mx-auto">
                  Make 7 quick choices between movie pairs, and our AI will recommend the perfect films for your taste.
                </p>
                <p className="text-base text-muted-foreground italic max-w-md mx-auto">
                  "Because choosing your movie, shouldn't take longer than watching it."
                </p>
              </div>

              <Button
                size="lg"
                onClick={handleStart}
                disabled={startSessionMutation.isPending}
                className="text-lg px-8 py-6"
                data-testid="button-start-game"
              >
                {startSessionMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  "Start Picking"
                )}
              </Button>

              {startSessionMutation.isError && (
                <p className="text-destructive">
                  Movies are still loading. Please wait a moment and try again.
                </p>
              )}
            </div>
          </div>
        )}

        {gameState === "playing" && roundQuery.data && !roundQuery.data.isComplete && (
          <RoundPicker
            round={roundQuery.data.round}
            totalRounds={roundQuery.data.totalRounds}
            leftMovie={roundQuery.data.leftMovie}
            rightMovie={roundQuery.data.rightMovie}
            onChoice={handleChoice}
            isSubmitting={choiceMutation.isPending}
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
          />
        )}
      </main>
    </div>
  );
}
