import type { RecommendationsResponse, Recommendation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Copy, Check, Share2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface ShareCardProps {
  isOpen: boolean;
  onClose: () => void;
  recommendations: Recommendation[];
  preferenceProfile: RecommendationsResponse["preferenceProfile"];
  shareUrl?: string;
}

export function ShareCard({ isOpen, onClose, recommendations, preferenceProfile, shareUrl }: ShareCardProps) {
  const [copied, setCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const { toast } = useToast();

  const topMovies = recommendations.slice(0, 5);
  const profileLine =
    preferenceProfile.profileLine?.trim() ||
    preferenceProfile.headline?.trim() ||
    "Tonight’s picks";

  const buildShareText = () => {
    return `${profileLine}\n\n${shareUrl ?? ""}`.trim();
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (typeof window !== "undefined" && window.posthog) {
        window.posthog.capture("share_clicked", { method: "copy_link" });
      }
      toast({ title: "Copied!", description: "Link copied to clipboard" });
      setTimeout(() => {
        setCopied(false);
        onClose();
      }, 1200);
    } catch {
      toast({ title: "Could not copy", description: "Try copying the link manually", variant: "destructive" });
    }
  };

  const handleNativeShare = async () => {
    if (!shareUrl) return;
    setIsSharing(true);
    try {
      if (typeof window !== "undefined" && window.posthog) {
        window.posthog.capture("share_clicked", { method: "native_share" });
      }
      await navigator.share({
        title: "WhatWeWatching",
        text: buildShareText(),
        url: shareUrl,
      });
      onClose();
    } catch {
      // User cancelled or share failed — stay open
    } finally {
      setIsSharing(false);
    }
  };

  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        hideCloseButton
        className="w-[min(92vw,380px)] max-w-[min(92vw,380px)] translate-x-[-50%] translate-y-[-50%] border-0 bg-transparent p-0 shadow-none gap-0 overflow-visible"
      >
        <div className="flex flex-col items-stretch gap-5">
          <DialogTitle className="sr-only">Share your picks</DialogTitle>
          {/* Story-style card — screenshot-friendly */}
          <div className="rounded-3xl bg-[#1a0a0a] px-5 pt-8 pb-7 shadow-2xl ring-1 ring-white/[0.06]">
            <div className="flex justify-center mb-6">
              <img
                src="/logo.png"
                alt="WhatWeWatching"
                className="h-7 md:h-8 w-auto object-contain object-center opacity-95"
              />
            </div>

            <p className="text-center text-white font-bold text-xl md:text-2xl leading-snug tracking-tight px-1 mb-7 text-balance">
              <span className="text-white/55 font-semibold">&ldquo;</span>
              {profileLine}
              <span className="text-white/55 font-semibold">&rdquo;</span>
            </p>

            <div className="flex flex-row justify-center gap-1.5 sm:gap-2 w-full">
              {topMovies.map((rec) => {
                const thumbUrl = rec.movie.posterPath
                  ? rec.movie.posterPath.startsWith("http")
                    ? rec.movie.posterPath
                    : `https://image.tmdb.org/t/p/w185${rec.movie.posterPath}`
                  : null;
                return (
                  <div
                    key={rec.movie.tmdbId}
                    className="flex-1 min-w-0 aspect-[2/3] rounded-md overflow-hidden bg-black/40 flex items-center justify-center ring-1 ring-white/[0.08]"
                  >
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt=""
                        className="w-full h-full object-contain object-center"
                      />
                    ) : (
                      <div className="w-full h-full bg-white/5" aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-center text-[10px] sm:text-[11px] tracking-[0.14em] text-red-800/55 mt-6 font-medium">
              whatwewatching.com.au
            </p>
          </div>

          {/* Actions below the card */}
          <div className="flex flex-col gap-2.5 px-1">
            {canNativeShare && (
              <Button
                onClick={handleNativeShare}
                disabled={isSharing || !shareUrl}
                className="w-full gap-2 h-11 font-semibold bg-white text-[#1a0a0a] hover:bg-white/90"
                data-testid="button-native-share"
              >
                <Share2 className="w-4 h-4" />
                {isSharing ? "Sharing..." : "Share via..."}
              </Button>
            )}
            <Button
              onClick={handleCopyLink}
              disabled={!shareUrl || copied}
              variant="outline"
              className="w-full gap-2 h-11 font-semibold border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              data-testid="button-copy-link"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy Link
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
