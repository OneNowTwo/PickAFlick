import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Trash2, Check, Film, Clapperboard, Bookmark } from "lucide-react";
import { Link } from "wouter";
import type { WatchlistItem } from "@shared/schema";

export default function Watchlist() {
  const { data: watchlist, isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  const toggleWatchedMutation = useMutation({
    mutationFn: async ({ id, watched }: { id: number; watched: boolean }) => {
      const res = await apiRequest("PATCH", `/api/watchlist/${id}/watched`, { watched });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/watchlist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  const unwatched = watchlist?.filter((m) => !m.watched) || [];
  const watched = watchlist?.filter((m) => m.watched) || [];

  return (
    <div className="min-h-screen bg-background w-full">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/">
            <a 
              className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -ml-2 transition-colors"
              data-testid="button-logo-home"
            >
              <Clapperboard className="w-6 h-6 text-primary" />
              <h1 className="text-xl font-bold text-foreground">PickAFlick</h1>
            </a>
          </Link>
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-primary" />
            <span className="font-medium text-foreground">My Watchlist</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-7xl mx-auto py-8 px-4">
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
                <h3 className="text-lg font-semibold mb-2">Your watchlist is empty</h3>
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
                      isPending={toggleWatchedMutation.isPending || removeMutation.isPending}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function MovieCard({
  item,
  onToggleWatched,
  onRemove,
  isPending,
}: {
  item: WatchlistItem;
  onToggleWatched: () => void;
  onRemove: () => void;
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
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={item.watched ? "outline" : "default"}
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
