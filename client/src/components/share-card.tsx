import type { RecommendationsResponse, Recommendation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Copy, Check, Share2, Film, Sparkles } from "lucide-react";
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

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      const fullText = `${buildShareText()}\n${shareUrl}`;
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      if (typeof window !== 'undefined' && window.posthog) {
        window.posthog.capture("share_clicked", { method: "copy_link" });
      }
      toast({ title: "Copied!", description: "Paste it anywhere to share your picks" });
      setTimeout(() => {
        setCopied(false);
        onClose();
      }, 1200);
    } catch {
      toast({ title: "Could not copy", description: "Try copying the link manually", variant: "destructive" });
    }
  };

  const buildShareText = () => {
    const movieLines = topMovies
      .map((rec, i) => `${i + 1}. ${rec.movie.title} (${rec.movie.year})`)
      .join("\n");
    return `My top movie picks tonight:\n${movieLines}\n\nSee them all 👆`;
  };

  const handleNativeShare = async () => {
    if (!shareUrl) return;
    setIsSharing(true);
    try {
      if (typeof window !== 'undefined' && window.posthog) {
        window.posthog.capture("share_clicked", { method: "native_share" });
      }
      await navigator.share({
        title: "My WhatWeWatching Picks",
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

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[92vw] max-w-sm p-0 overflow-hidden border border-white/10 bg-[#0d0d0d]">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/8">
          <div className="flex items-center gap-2 mb-2">
            <Share2 className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Share Your Picks</span>
          </div>
          <h2 className="text-base font-bold text-white leading-snug">Your top movies tonight</h2>
          {preferenceProfile.topGenres.length > 0 && (
            <p className="text-xs text-white/40 mt-1">
              {preferenceProfile.topGenres.slice(0, 3).join(" · ")}
            </p>
          )}
        </div>

        {/* Movie list */}
        <div className="px-5 py-4 space-y-3">
          {topMovies.map((rec, i) => (
            <div key={rec.movie.tmdbId} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white leading-snug break-words">{rec.movie.title}</p>
                <p className="text-xs text-white/40 mt-0.5">
                  {rec.movie.year}{rec.movie.genres.length > 0 && ` · ${rec.movie.genres.slice(0, 2).join(", ")}`}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Share actions */}
        <div className="px-5 pb-5 pt-2 space-y-2 border-t border-white/8">
          {canNativeShare && (
            <Button
              onClick={handleNativeShare}
              disabled={isSharing || !shareUrl}
              className="w-full gap-2"
              data-testid="button-native-share"
            >
              <Share2 className="w-4 h-4" />
              {isSharing ? "Sharing..." : "Share via..."}
            </Button>
          )}
          <Button
            onClick={handleCopyLink}
            disabled={!shareUrl || copied}
            variant={canNativeShare ? "outline" : "default"}
            className="w-full gap-2"
            data-testid="button-copy-link"
          >
            {copied ? <><Check className="w-4 h-4" />Copied!</> : <><Copy className="w-4 h-4" />Copy Link</>}
          </Button>
          <p className="text-center text-white/25 text-xs pt-1 flex items-center justify-center gap-1">
            <Film className="w-3 h-3" />
            whatwewatching.com.au
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
