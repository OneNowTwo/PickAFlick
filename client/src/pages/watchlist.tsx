import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWatchlistSession } from "@/hooks/use-watchlist-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Trash2, Check, Film, Bookmark, Tv, ArrowLeft, Mail } from "lucide-react";
import { Footer } from "@/components/footer";
import { Link } from "wouter";
import type { WatchlistItem, WatchProvidersResponse } from "@shared/schema";

export default function Watchlist() {
  const watchlistSessionId = useWatchlistSession();
  const [selectedTmdbId, setSelectedTmdbId] = useState<number | null>(null);
  const [showWatchProviders, setShowWatchProviders] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<{ tmdbId: number; title: string; year: number | null } | null>(null);

  const from = useMemo(() => new URLSearchParams(window.location.search).get("from"), []);
  const returnHref = from === "home" ? "/?resume=1" : "/";

  const { data: watchlist, isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist", watchlistSessionId],
    queryFn: async () => {
      const res = await fetch(`/api/watchlist?session=${encodeURIComponent(watchlistSessionId)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return res.json();
    },
    enabled: !!watchlistSessionId,
  });

  const { data: watchProviders, isLoading: isLoadingProviders } = useQuery<WatchProvidersResponse>({
    queryKey: [`/api/watch-providers/${selectedTmdbId}?title=${encodeURIComponent(selectedMovie?.title || "")}&year=${selectedMovie?.year || ""}`],
    enabled: showWatchProviders && !!selectedTmdbId && !!selectedMovie,
  });

  const handleWatchNow = (tmdbId: number, title: string, year: number | null) => {
    setSelectedTmdbId(tmdbId);
    setSelectedMovie({ tmdbId, title, year });
    setShowWatchProviders(true);
  };

  const toggleWatchedMutation = useMutation({
    mutationFn: async ({ id, watched }: { id: number; watched: boolean }) => {
      const res = await apiRequest("PATCH", `/api/watchlist/${id}/watched`, {
        watched,
        sessionId: watchlistSessionId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist", watchlistSessionId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest(
        "DELETE",
        `/api/watchlist/${id}?session=${encodeURIComponent(watchlistSessionId)}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist", watchlistSessionId] });
    },
  });

  const unwatched = watchlist?.filter((m) => !m.watched) || [];
  const watched = watchlist?.filter((m) => m.watched) || [];

  return (
    <div className="min-h-screen bg-background w-full flex flex-col">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/">
            <a 
              className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -ml-2 transition-colors"
              data-testid="button-logo-home"
            >
              <img src="/logo.png" alt="WhatWeWatching" className="h-12 md:h-14 w-auto" />
            </a>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/contact">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="button-contact">
                <Mail className="w-4 h-4" />
                <span className="hidden sm:inline">Contact</span>
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Bookmark className="w-4 h-4 text-primary" />
              <span className="font-medium text-foreground hidden sm:inline">My Watchlist</span>
            </div>
            <Link href="/">
              <Button 
                variant="ghost" 
                size="sm"
                className="gap-2"
                data-testid="button-back-home"
              >
                <Film className="w-4 h-4" />
                <span className="hidden sm:inline">Home</span>
                <span className="sm:hidden">Home</span>
              </Button>
            </Link>
            <Link href={returnHref}>
              <Button 
                variant="outline" 
                size="sm"
                className="gap-2"
                data-testid="button-back-to-recommendations"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Recommendations</span>
                <span className="sm:hidden">Back</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="w-full max-w-7xl mx-auto py-8 px-4 flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-bold text-foreground">My Watchlist</h2>
              <p className="text-muted-foreground">
                {unwatched.length} to watch, {watched.length} watched
              </p>
            </div>

            {watchlist?.length === 0 && (
              <Card className="p-8 text-center">
                <Film className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">You haven&apos;t saved anything yet</h3>
                <p className="text-muted-foreground mb-4">
                  Play the movie picker and like some recommendations to build your list!
                </p>
                <Link href="/">
                  <Button data-testid="button-start-picking">Start Picking</Button>
                </Link>
              </Card>
            )}

            {unwatched.length > 0 && (
              <section>
                <h3 className="text-xl font-semibold text-foreground mb-4">To Watch</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {unwatched.map((item) => (
                    <MovieCard
                      key={item.id}
                      item={item}
                      onToggleWatched={() => toggleWatchedMutation.mutate({ id: item.id, watched: true })}
                      onRemove={() => removeMutation.mutate(item.id)}
                      onWatchNow={() => handleWatchNow(item.tmdbId, item.title, item.year)}
                      isPending={toggleWatchedMutation.isPending || removeMutation.isPending}
                    />
                  ))}
                </div>
              </section>
            )}

            {watched.length > 0 && (
              <section>
                <h3 className="text-xl font-semibold text-foreground mb-4">Watched</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {watched.map((item) => (
                    <MovieCard
                      key={item.id}
                      item={item}
                      onToggleWatched={() => toggleWatchedMutation.mutate({ id: item.id, watched: false })}
                      onRemove={() => removeMutation.mutate(item.id)}
                      onWatchNow={() => handleWatchNow(item.tmdbId, item.title, item.year)}
                      isPending={toggleWatchedMutation.isPending || removeMutation.isPending}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Watch Providers Dialog */}
      <Dialog open={showWatchProviders} onOpenChange={setShowWatchProviders}>
        <DialogContent className="max-w-md">
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
      <Footer />
    </div>
  );
}

function MovieCard({
  item,
  onToggleWatched,
  onRemove,
  onWatchNow,
  isPending,
}: {
  item: WatchlistItem;
  onToggleWatched: () => void;
  onRemove: () => void;
  onWatchNow: () => void;
  isPending: boolean;
}) {
  const posterUrl = item.posterPath
    ? item.posterPath.startsWith("http")
      ? item.posterPath
      : `https://image.tmdb.org/t/p/w300${item.posterPath}`
    : null;

  return (
    <Card
      className={`overflow-hidden group relative ${item.watched ? "opacity-60" : ""}`}
      data-testid={`watchlist-card-${item.id}`}
    >
      <div className="aspect-[2/3] relative">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <Film className="w-8 h-8 text-muted-foreground" />
          </div>
        )}

        {item.watched && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="bg-green-600 rounded-full p-2">
              <Check className="w-6 h-6 text-white" />
            </div>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={onWatchNow}
              className="w-full gap-1 text-xs"
              data-testid={`button-watch-now-${item.id}`}
            >
              <Tv className="w-3 h-3" />
              Watch Now
            </Button>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={item.watched ? "outline" : "secondary"}
                onClick={onToggleWatched}
                disabled={isPending}
                className="flex-1 text-xs"
                data-testid={`button-toggle-watched-${item.id}`}
              >
                {item.watched ? "Unwatch" : "Watched"}
              </Button>
              <Button
                size="icon"
                variant="destructive"
                onClick={onRemove}
                disabled={isPending}
                className="shrink-0"
                data-testid={`button-remove-${item.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-3">
        <h4 className="font-medium text-sm text-foreground line-clamp-1">{item.title}</h4>
        <p className="text-xs text-muted-foreground">
          {item.year}
          {item.rating ? ` • ${(item.rating / 10).toFixed(1)}★` : ""}
        </p>
      </div>
    </Card>
  );
}
