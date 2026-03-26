import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Trash2, Film, ArrowLeft, Mail, BookmarkX, Tv } from "lucide-react";
import { Footer } from "@/components/footer";
import { PosterGridBackground } from "@/components/poster-grid-background";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import type { UserWatchlistItem, WatchProvidersResponse } from "@shared/schema";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w300";

export default function Watchlist() {
  const { user, loading: authLoading, login } = useAuth();
  const [providersMovie, setProvidersMovie] = useState<{ tmdbId: number; title: string; year: number | null } | null>(null);

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

  const { data: watchProviders, isLoading: isLoadingProviders } = useQuery<WatchProvidersResponse>({
    queryKey: [
      `/api/watch-providers/${providersMovie?.tmdbId}`,
      providersMovie?.title,
      providersMovie?.year,
    ],
    queryFn: async () => {
      const { tmdbId, title, year } = providersMovie!;
      const res = await fetch(
        `/api/watch-providers/${tmdbId}?title=${encodeURIComponent(title)}&year=${year ?? ""}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch providers");
      return res.json();
    },
    enabled: !!providersMovie,
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
                  onWhereToWatch={() => setProvidersMovie({ tmdbId: item.tmdbId, title: item.title, year: item.releaseYear ?? null })}
                  isRemoving={removeMutation.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Where to Watch dialog */}
      <Dialog open={!!providersMovie} onOpenChange={(open) => { if (!open) setProvidersMovie(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tv className="w-5 h-5 text-primary" />
              Where to Watch
            </DialogTitle>
            {providersMovie && (
              <p className="text-sm text-muted-foreground">{providersMovie.title}</p>
            )}
          </DialogHeader>

          <div className="py-2">
            {isLoadingProviders ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : watchProviders && watchProviders.providers.length > 0 ? (
              <div className="space-y-4">
                <ProviderGroup label="Stream" providers={watchProviders.providers.filter(p => p.type === "subscription")} movieTitle={providersMovie?.title} />
                <ProviderGroup label="Rent" providers={watchProviders.providers.filter(p => p.type === "rent")} movieTitle={providersMovie?.title} />
                <ProviderGroup label="Buy" providers={watchProviders.providers.filter(p => p.type === "buy")} movieTitle={providersMovie?.title} />
                <p className="text-xs text-muted-foreground text-center pt-1">Providers from TMDb · Opens in a new tab</p>
              </div>
            ) : (
              <div className="text-center py-8">
                <Tv className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No streaming links found for this title in Australia.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}

function ProviderGroup({
  label,
  providers,
  movieTitle,
}: {
  label: string;
  providers: WatchProvidersResponse["providers"];
  movieTitle?: string;
}) {
  if (providers.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</h4>
      <div className="grid grid-cols-3 gap-3">
        {providers.map((provider) => (
          <a
            key={provider.id}
            href={provider.deepLink || "#"}
            onClick={(e) => {
              e.preventDefault();
              if (typeof window !== "undefined" && (window as any).posthog) {
                (window as any).posthog.capture("provider_click", {
                  provider: provider.name,
                  provider_type: provider.type,
                  movie_title: movieTitle,
                  source: "watchlist",
                });
              }
              window.open(provider.deepLink || "#", "_blank", "noopener,noreferrer");
            }}
            className="flex flex-col items-center gap-2 p-3 bg-card border border-border rounded-lg hover:border-primary/40 transition-all"
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
  );
}

function WatchlistCard({
  item,
  onRemove,
  onWhereToWatch,
  isRemoving,
}: {
  item: UserWatchlistItem;
  onRemove: () => void;
  onWhereToWatch: () => void;
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

        {/* Hover overlay — Where to Watch + Remove */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2 gap-1.5">
          <button
            onClick={onWhereToWatch}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <Tv className="w-3 h-3" />
            Where to Watch
          </button>
          <button
            onClick={onRemove}
            disabled={isRemoving}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-black/60 text-white/70 text-xs hover:bg-red-900/60 hover:text-red-300 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Remove
          </button>
        </div>
      </div>

      {/* Info — title uses h3 to match the display font (Bebas Neue) used on posters */}
      <div className="p-3 flex flex-col gap-1">
        <h3 className="text-white text-sm leading-snug line-clamp-2">{item.title}</h3>
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
