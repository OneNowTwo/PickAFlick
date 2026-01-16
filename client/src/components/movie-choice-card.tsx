import type { Movie } from "@shared/schema";

interface MovieChoiceCardProps {
  movie: Movie;
  onSelect: () => void;
  isSelected?: boolean;
  side: "left" | "right";
}

export function MovieChoiceCard({ movie, onSelect, isSelected, side }: MovieChoiceCardProps) {
  const posterUrl = movie.posterPath 
    ? movie.posterPath.startsWith("http") 
      ? movie.posterPath 
      : `https://image.tmdb.org/t/p/w500${movie.posterPath}`
    : null;

  return (
    <button
      onClick={onSelect}
      className={`
        relative w-full aspect-[2/3] rounded-xl overflow-hidden transition-all duration-300
        hover-elevate active-elevate-2 cursor-pointer
        ${isSelected ? "ring-4 ring-primary scale-[1.02]" : "ring-0"}
      `}
      data-testid={`movie-choice-${side}`}
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt={movie.title}
          className="w-full h-full object-cover"
          loading="eager"
        />
      ) : (
        <div className="w-full h-full bg-muted flex items-center justify-center">
          <span className="text-muted-foreground text-lg">No Poster</span>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

      <div className="absolute bottom-0 left-0 right-0 p-4 text-left">
        <h3 className="text-white font-bold text-lg md:text-xl line-clamp-2">
          {movie.title}
        </h3>
        <p className="text-white/70 text-sm">
          {movie.year} {movie.rating ? `• ${movie.rating.toFixed(1)}★` : ""}
        </p>
        {movie.genres.length > 0 && (
          <p className="text-white/60 text-xs mt-1 line-clamp-1">
            {movie.genres.slice(0, 3).join(" • ")}
          </p>
        )}
      </div>

      <div 
        className={`
          absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center
          transition-all duration-200
          ${isSelected ? "bg-primary scale-110" : "bg-white/20"}
        `}
      >
        {isSelected && (
          <svg className="w-6 h-6 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </button>
  );
}
