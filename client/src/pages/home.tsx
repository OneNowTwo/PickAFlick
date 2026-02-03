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

// Mood/genre options for users to select
const MOOD_OPTIONS = [
  { id: "action", label: "Action & Adventure", genres: ["Action", "Adventure"] },
  { id: "comedy", label: "Comedy", genres: ["Comedy"] },
  { id: "drama", label: "Drama", genres: ["Drama"] },
  { id: "horror", label: "Horror & Thriller", genres: ["Horror", "Thriller"] },
  { id: "scifi", label: "Sci-Fi & Fantasy", genres: ["Science Fiction", "Fantasy"] },
  { id: "romance", label: "Romance", genres: ["Romance"] },
  { id: "mystery", label: "Mystery & Crime", genres: ["Mystery", "Crime"] },
  { id: "top", label: "Top Picks", genres: [] }, // Special case - top rated/popular
];

export default function Home() {
  const [gameState, setGameState] = useState<GameState>("start");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationsResponse | null>(null);
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);

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

  // Start session mutation
  const startSessionMutation = useMutation({
    mutationFn: async () => {
      const genres = getSelectedGenres();
      const includeTopPicks = selectedMoods.includes("top");
      const res = await apiRequest("POST", "/api/session/start", { genres, includeTopPicks });
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
        
        // PROGRESSIVE LOADING: Fetch first recommendation quickly, then load the rest
        try {
          // Step 1: Get first recommendation fast (3-4 seconds)
          const firstRes = await fetch(`/api/session/${sessionId}/recommendations?quick=true`);
          if (firstRes.ok) {
            const firstRec = await firstRes.json() as RecommendationsResponse;
            setRecommendations(firstRec); // Show the first one immediately
            setGameState("results");
          }
          
          // Step 2: Load remaining recommendations in background (8-10 seconds)
          const fullRes = await fetch(`/api/session/${sessionId}/recommendations`);
          if (fullRes.ok) {
            const fullRecs = await fullRes.json() as RecommendationsResponse;
            setRecommendations(fullRecs); // Replace with full set
          }
        } catch (error) {
          console.error("Failed to get recommendations:", error);
          // Fallback to regular loading if progressive fails
          try {
            const res = await fetch(`/api/session/${sessionId}/recommendations`);
            if (res.ok) {
              const recs = await res.json() as RecommendationsResponse;
              setRecommendations(recs);
            }
          } catch (fallbackError) {
            console.error("Fallback also failed:", fallbackError);
          }
          setGameState("results");
        }
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
    setSessionId(null);
    setRecommendations(null);
    setSelectedMoods([]);
    setGameState("start");
  }, []);

  return (
    <div className="min-h-screen w-full">
      <PosterGridBackground />
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
            <div className="relative z-10 flex flex-col items-center justify-center gap-6 text-center max-w-3xl mx-auto">
              <div className="space-y-3 p-6 md:p-8 rounded-lg" style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
                <h2 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">
                  Find Your Perfect Movie
                </h2>
                <p className="text-lg text-gray-300 italic max-w-md mx-auto drop-shadow-md">
                  "Because choosing your movie shouldn't take longer than watching it."
                </p>
              </div>

              {/* Mood Selection - Clear tappable buttons */}
              <div className="p-6 rounded-lg w-full" style={{ background: 'rgba(0, 0, 0, 0.6)' }}>
                <h3 className="text-xl font-bold text-white mb-1">Tap Your Mood</h3>
                <p className="text-gray-400 text-sm mb-4">Pick genres or skip for everything</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
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
                  <>
                    <Clapperboard className="w-5 h-5 mr-2" />
                    {selectedMoods.length > 0 ? "Start Picking" : "Surprise Me"}
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
    </div>
  );
}
