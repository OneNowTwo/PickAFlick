import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CatalogueResponse, RecResponse, TrailerResponse } from "@shared/schema";
import { CardStack } from "@/components/card-stack";
import { TrailerSection } from "@/components/trailer-section";
import { Clapperboard } from "lucide-react";

export default function Home() {
  const [rerollToken, setRerollToken] = useState(0);

  const catalogueQuery = useQuery<CatalogueResponse>({
    queryKey: ["/api/catalogue", rerollToken],
    queryFn: async () => {
      const res = await fetch("/api/catalogue", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch catalogue");
      return res.json();
    },
    staleTime: 0,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(2000 * 2 ** attemptIndex, 10000),
  });

  const recsQuery = useQuery<RecResponse>({
    queryKey: ["/api/recs", rerollToken],
    queryFn: async () => {
      const res = await fetch("/api/recs?limit=6", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch recommendations");
      return res.json();
    },
    staleTime: 0,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(2000 * 2 ** attemptIndex, 10000),
  });

  const recIds = recsQuery.data?.movies.map((m) => m.id).join(",") || "";

  const trailersQuery = useQuery<TrailerResponse>({
    queryKey: ["/api/trailers", recIds, rerollToken],
    queryFn: async () => {
      if (!recIds) return {};
      const res = await fetch(`/api/trailers?ids=${recIds}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch trailers");
      return res.json();
    },
    enabled: !!recIds,
    staleTime: 0,
  });

  const handleShuffle = useCallback(() => {
    setRerollToken((prev) => prev + 1);
  }, []);

  const isShuffling = catalogueQuery.isFetching || recsQuery.isFetching;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Clapperboard className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">PickAFlick</h1>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <section className="mb-12">
          <CardStack
            movies={catalogueQuery.data?.movies || []}
            isLoading={catalogueQuery.isLoading}
            isError={catalogueQuery.isError}
            onShuffle={handleShuffle}
            isShuffling={isShuffling}
          />
        </section>

        <TrailerSection
          movies={recsQuery.data?.movies || []}
          trailers={trailersQuery.data || {}}
          isLoading={recsQuery.isLoading || trailersQuery.isLoading}
          rerollToken={rerollToken}
        />
      </main>
    </div>
  );
}
