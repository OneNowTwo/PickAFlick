import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Film, ArrowLeft, Mail, BookmarkX } from "lucide-react";
import { Footer } from "@/components/footer";
import { PosterGridBackground } from "@/components/poster-grid-background";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { UserWatchlistItem } from "@shared/schema";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w300";

export default function Watchlist() {
  const { user, loading: authLoading, login } = useAuth();

  const { data: items = [], isLoading } = useQuery<UserWatchlistItem[]>({
    queryKey: ["/api/watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/watchlist", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return res.json();
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: true,
  });

  const removeMutation = useMutation({
    mutationFn: async (tmdbId: number) => {
      const res = await fetch(`/api/watchlist/${tmdbId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
  });

  return (
    <div className="min-h-screen w-full flex flex-col">
      <PosterGridBackground />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/">
            <span className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -ml-2 transition-colors cursor-pointer">
              <img src="/logo.png" alt="WhatWeWatching" className="w-48 md:w-64 h-auto" />
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/contact">
              <Button variant="ghost" className="gap-2">
                <Mail className="w-4 h-4" />
                <span className="hidden sm:inline">Contact</span>
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Picks</span>
                <span className="sm:hidden">Back</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-7xl mx-auto py-8 px-4 flex-1">
        {authLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>

        ) : !user ? (
          /* Not signed in */
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
            <BookmarkX className="w-16 h-16 text-white/20" />
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Sign in to see your watchlist</h2>
              <p className="text-white/50 text-sm">Your saved movies live here — sign in to access them.</p>
            </div>
            <Button size="lg" onClick={login} className="gap-2 font-semibold">
              Continue with Google
            </Button>
          </div>

        ) : isLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>

        ) : items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
            <Film className="w-16 h-16 text-white/20" />
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Nothing saved yet</h2>
              <p className="text-white/50 text-sm">Start picking to build your watchlist</p>
            </div>
            <Link href="/">
              <Button size="lg" className="font-semibold">Start Picking</Button>
            </Link>
          </div>

        ) : (
          /* Watchlist grid */
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-bold text-white">My Watchlist</h2>
              <p className="text-white/50 text-sm mt-1">{items.length} {items.length === 1 ? "movie" : "movies"} saved</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {items.map((item) => (
                <WatchlistCard
                  key={item.id}
                  item={item}
                  onRemove={() => removeMutation.mutate(item.tmdbId)}
                  isRemoving={removeMutation.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

function WatchlistCard({
  item,
  onRemove,
  isRemoving,
}: {
  item: UserWatchlistItem;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const posterUrl = item.posterPath
    ? item.posterPath.startsWith("http")
      ? item.posterPath
      : `${TMDB_IMAGE_BASE}${item.posterPath}`
    : null;

  return (
    <div className="group relative flex flex-col rounded-xl overflow-hidden bg-black/40 border border-white/8 hover:border-white/20 transition-all duration-200">
      {/* Poster */}
      <div className="aspect-[2/3] relative">
        {posterUrl ? (
          <img src={posterUrl} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-white/5 flex items-center justify-center">
            <Film className="w-8 h-8 text-white/20" />
          </div>
        )}

        {/* Remove button — appears on hover */}
        <button
          onClick={onRemove}
          disabled={isRemoving}
          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white/60 hover:text-red-400 hover:bg-black/90 opacity-0 group-hover:opacity-100 transition-all duration-150"
          title="Remove from watchlist"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1">
        <h4 className="text-white text-sm font-semibold line-clamp-2 leading-snug">{item.title}</h4>
        <div className="flex flex-wrap gap-1 items-center">
          {item.releaseYear && (
            <span className="text-white/40 text-xs">{item.releaseYear}</span>
          )}
          {item.genres.slice(0, 2).map((g) => (
            <span key={g} className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-white/50">
              {g}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
