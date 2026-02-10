import type { RecommendationsResponse, Recommendation } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, Copy, Check, Sparkles, Film, Palette, Clock, Zap, Heart, Compass, Glasses, Drama, Rocket, Search, Clapperboard, Moon, Smile, Wand2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface ShareCardProps {
  isOpen: boolean;
  onClose: () => void;
  recommendations: Recommendation[];
  preferenceProfile: RecommendationsResponse["preferenceProfile"];
  shareUrl?: string;
}

// Movie personality type with icon instead of emoji
interface MoviePersonality {
  title: string;
  icon: "moon" | "zap" | "drama" | "smile" | "wand" | "clapperboard" | "glasses" | "compass" | "rocket" | "heart" | "search" | "film";
  description: string;
}

// Generate a fun movie personality type based on their taste
function generateMoviePersonality(profile: RecommendationsResponse["preferenceProfile"]): MoviePersonality {
  const genres = profile.topGenres.map(g => g.toLowerCase());
  const mood = profile.mood?.toLowerCase() || "";
  const visual = profile.visualStyle?.toLowerCase() || "";
  
  // Match personality based on genre/mood combinations
  if (genres.some(g => g.includes("horror") || g.includes("thriller"))) {
    if (mood.includes("intense") || mood.includes("dark")) {
      return { title: "The Night Owl", icon: "moon", description: "You thrive when the lights go down and the tension goes up" };
    }
    return { title: "The Thrill Seeker", icon: "zap", description: "Life's too short for boring movies" };
  }
  
  if (genres.some(g => g.includes("comedy"))) {
    if (genres.some(g => g.includes("drama"))) {
      return { title: "The Feeling Finder", icon: "drama", description: "You want to laugh and cry in the same sitting" };
    }
    return { title: "The Joy Chaser", icon: "smile", description: "Here for the good vibes and great laughs" };
  }
  
  if (genres.some(g => g.includes("sci-fi") || g.includes("fantasy"))) {
    return { title: "The World Builder", icon: "wand", description: "Reality is just the starting point for you" };
  }
  
  if (genres.some(g => g.includes("drama"))) {
    if (visual.includes("striking") || visual.includes("artistic")) {
      return { title: "The Cinema Connoisseur", icon: "clapperboard", description: "You appreciate the art behind every frame" };
    }
    if (mood.includes("thought") || mood.includes("deep")) {
      return { title: "The Deep Diver", icon: "glasses", description: "Surface-level stories need not apply" };
    }
    return { title: "The Story Chaser", icon: "compass", description: "A great narrative is your happy place" };
  }
  
  if (genres.some(g => g.includes("action") || g.includes("adventure"))) {
    return { title: "The Adrenaline Junkie", icon: "rocket", description: "You like your movies like you like your life: exciting" };
  }
  
  if (genres.some(g => g.includes("romance"))) {
    return { title: "The Hopeless Romantic", icon: "heart", description: "You believe in movie magic and happy endings" };
  }
  
  if (genres.some(g => g.includes("mystery") || g.includes("crime"))) {
    return { title: "The Plot Unraveler", icon: "search", description: "Nothing gets past you - except that twist ending" };
  }
  
  // Default personality
  return { title: "The Film Explorer", icon: "film", description: "Every genre is an adventure waiting to happen" };
}

// Render personality icon
function PersonalityIcon({ icon, className }: { icon: MoviePersonality["icon"]; className?: string }) {
  const iconClass = className || "w-12 h-12";
  switch (icon) {
    case "moon": return <Moon className={iconClass} />;
    case "zap": return <Zap className={iconClass} />;
    case "drama": return <Drama className={iconClass} />;
    case "smile": return <Smile className={iconClass} />;
    case "wand": return <Wand2 className={iconClass} />;
    case "clapperboard": return <Clapperboard className={iconClass} />;
    case "glasses": return <Glasses className={iconClass} />;
    case "compass": return <Compass className={iconClass} />;
    case "rocket": return <Rocket className={iconClass} />;
    case "heart": return <Heart className={iconClass} />;
    case "search": return <Search className={iconClass} />;
    case "film": return <Film className={iconClass} />;
    default: return <Film className={iconClass} />;
  }
}

// Generate quirky stats based on their choices
function generateQuirkyStats(profile: RecommendationsResponse["preferenceProfile"]): string[] {
  const stats: string[] = [];
  
  if (profile.topGenres.length > 0) {
    const primary = profile.topGenres[0];
    stats.push(`${primary} is your comfort zone`);
  }
  
  if (profile.preferredEras && profile.preferredEras.length > 0) {
    const era = profile.preferredEras[0];
    if (era.includes("classic") || era.includes("80s") || era.includes("90s")) {
      stats.push("Old school at heart");
    } else if (era.includes("2020") || era.includes("recent")) {
      stats.push("Fresh picks only");
    } else {
      stats.push(`${era} vibes`);
    }
  }
  
  if (profile.mood) {
    if (profile.mood.toLowerCase().includes("intense")) {
      stats.push("Intensity seeker");
    } else if (profile.mood.toLowerCase().includes("light")) {
      stats.push("Feel-good hunter");
    } else if (profile.mood.toLowerCase().includes("thought")) {
      stats.push("Deep thinker");
    }
  }
  
  if (profile.visualStyle) {
    if (profile.visualStyle.toLowerCase().includes("striking") || profile.visualStyle.toLowerCase().includes("artistic")) {
      stats.push("Eyes for art");
    }
  }
  
  return stats.slice(0, 3);
}

export function ShareCard({ isOpen, onClose, recommendations, preferenceProfile, shareUrl }: ShareCardProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  
  const personality = generateMoviePersonality(preferenceProfile);
  const quirkyStats = generateQuirkyStats(preferenceProfile);
  const topMovies = recommendations.slice(0, 5);
  
  const handleCopyLink = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ title: "Link copied!", description: "Share your movie picks with friends" });
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  const handleShare = async () => {
    const shareText = `I'm "${personality.title}"\n${personality.description}\n\nMy picks:\n${topMovies.map(r => `${r.movie.title} (${r.movie.year})`).join('\n')}\n\nFind your movie personality:`;
    
    if (navigator.share && shareUrl) {
      try {
        await navigator.share({
          title: `My Movie Personality: ${personality.title}`,
          text: shareText,
          url: shareUrl,
        });
      } catch {
        // Fallback to copy
        handleCopyLink();
      }
    } else {
      handleCopyLink();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-transparent border-0">
        <div 
          className="relative w-full bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 rounded-2xl overflow-hidden"
          data-testid="share-card"
        >
          {/* Close button - positioned within content bounds */}
          <button 
            onClick={onClose}
            className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full bg-black/30 flex items-center justify-center text-white/80 hover:text-white transition-colors"
            data-testid="button-close-share-card"
          >
            <X className="w-4 h-4" />
          </button>
          
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-10 left-10 w-32 h-32 rounded-full bg-white blur-3xl" />
            <div className="absolute bottom-20 right-10 w-40 h-40 rounded-full bg-white blur-3xl" />
            <div className="absolute top-1/2 left-1/2 w-24 h-24 rounded-full bg-white blur-2xl" />
          </div>
          
          {/* Content */}
          <div className="relative z-10 p-6 text-white">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="inline-block px-3 py-1 bg-white/20 rounded-full text-xs font-medium mb-3">
                WHATWEWATCHING WRAPPED
              </div>
              <div className="mb-2 flex justify-center">
                <PersonalityIcon icon={personality.icon} className="w-12 h-12" />
              </div>
              <h2 className="text-2xl font-bold mb-1">{personality.title}</h2>
              <p className="text-white/80 text-sm">{personality.description}</p>
            </div>
            
            {/* Quirky stats */}
            {quirkyStats.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-6">
                {quirkyStats.map((stat, i) => (
                  <span 
                    key={i}
                    className="px-3 py-1.5 bg-white/15 rounded-full text-xs font-medium backdrop-blur-sm"
                  >
                    {stat}
                  </span>
                ))}
              </div>
            )}
            
            {/* Top genres */}
            {preferenceProfile.topGenres.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Film className="w-4 h-4 text-white/70" />
                  <span className="text-xs text-white/70 uppercase tracking-wide">Your Vibe</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {preferenceProfile.topGenres.slice(0, 3).map((genre, i) => (
                    <span 
                      key={genre}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                        i === 0 ? 'bg-white text-purple-700' : 'bg-white/20'
                      }`}
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Movie picks */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-white/70" />
                <span className="text-xs text-white/70 uppercase tracking-wide">Your Perfect Picks</span>
              </div>
              <div className="space-y-2">
                {topMovies.map((rec, i) => (
                  <div 
                    key={rec.movie.tmdbId}
                    className="flex items-center gap-3 p-2 bg-white/10 rounded-lg backdrop-blur-sm"
                  >
                    <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{rec.movie.title}</p>
                      <p className="text-xs text-white/60">{rec.movie.year} {rec.movie.genres.length > 0 && `· ${rec.movie.genres.slice(0, 2).join(", ")}`}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Visual style / mood */}
            {(preferenceProfile.visualStyle || preferenceProfile.mood) && (
              <div className="flex flex-wrap gap-2 mb-6">
                {preferenceProfile.visualStyle && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 rounded-full text-xs">
                    <Palette className="w-3 h-3" />
                    {preferenceProfile.visualStyle.split(" ").slice(0, 4).join(" ")}
                  </div>
                )}
                {preferenceProfile.mood && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 rounded-full text-xs">
                    <Clock className="w-3 h-3" />
                    {preferenceProfile.mood.split(" ").slice(0, 4).join(" ")}
                  </div>
                )}
              </div>
            )}
            
            {/* Footer / CTA */}
            <div className="pt-4 border-t border-white/20">
              <div className="flex gap-2">
                <Button
                  onClick={handleShare}
                  variant="secondary"
                  className="flex-1 bg-white text-purple-700 border-0 font-semibold"
                  data-testid="button-share-card"
                >
                  {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? "Copied!" : "Share My Picks"}
                </Button>
              </div>
              <p className="text-center text-white/50 text-xs mt-3">
              whatwewatching.com.au
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
