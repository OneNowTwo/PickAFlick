import { useState, useRef, useEffect } from "react";
import type { Movie } from "@shared/schema";
import { Film } from "lucide-react";

interface MovieCardProps {
  movie: Movie;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  isActive: boolean;
  stackIndex: number;
}

export function MovieCard({ movie, onSwipeLeft, onSwipeRight, isActive, stackIndex }: MovieCardProps) {
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const startPos = useRef({ x: 0, y: 0 });

  const posterUrl = movie.posterPath
    ? `https://image.tmdb.org/t/p/w500${movie.posterPath}`
    : null;

  const rotation = (dragOffset.x / 15);
  const opacity = Math.max(0, 1 - Math.abs(dragOffset.x) / 500);

  const handleDragStart = (clientX: number, clientY: number) => {
    if (!isActive) return;
    setIsDragging(true);
    startPos.current = { x: clientX, y: clientY };
  };

  const handleDragMove = (clientX: number, clientY: number) => {
    if (!isDragging || !isActive) return;
    const deltaX = clientX - startPos.current.x;
    const deltaY = clientY - startPos.current.y;
    setDragOffset({ x: deltaX, y: deltaY * 0.3 });
  };

  const handleDragEnd = () => {
    if (!isDragging || !isActive) return;
    setIsDragging(false);

    if (dragOffset.x > 100) {
      setExitDirection("right");
      setTimeout(() => onSwipeRight(), 300);
    } else if (dragOffset.x < -100) {
      setExitDirection("left");
      setTimeout(() => onSwipeLeft(), 300);
    } else {
      setDragOffset({ x: 0, y: 0 });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleDragMove(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    handleDragEnd();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragMove(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = () => {
    handleDragEnd();
  };

  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseMove = (e: MouseEvent) => handleDragMove(e.clientX, e.clientY);
      const handleGlobalMouseUp = () => handleDragEnd();

      window.addEventListener("mousemove", handleGlobalMouseMove);
      window.addEventListener("mouseup", handleGlobalMouseUp);

      return () => {
        window.removeEventListener("mousemove", handleGlobalMouseMove);
        window.removeEventListener("mouseup", handleGlobalMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  const stackScale = 1 - stackIndex * 0.05;
  const stackY = stackIndex * 8;
  const stackOpacity = stackIndex === 0 ? 1 : 0.6 - stackIndex * 0.15;

  let cardClassName = "absolute w-full h-full rounded-2xl overflow-hidden cursor-grab active:cursor-grabbing select-none";
  
  if (exitDirection === "left") {
    cardClassName += " animate-card-exit-left";
  } else if (exitDirection === "right") {
    cardClassName += " animate-card-exit-right";
  }

  const cardStyle: React.CSSProperties = {
    transform: isActive && !exitDirection
      ? `translateX(${dragOffset.x}px) translateY(${dragOffset.y}px) rotate(${rotation}deg)`
      : `scale(${stackScale}) translateY(${stackY}px)`,
    opacity: isActive ? opacity : stackOpacity,
    zIndex: 10 - stackIndex,
    transition: isDragging ? "none" : "transform 0.3s ease-out, opacity 0.3s ease-out",
  };

  return (
    <div
      ref={cardRef}
      className={cardClassName}
      style={cardStyle}
      onMouseDown={isActive ? handleMouseDown : undefined}
      onTouchStart={isActive ? handleTouchStart : undefined}
      onTouchMove={isActive ? handleTouchMove : undefined}
      onTouchEnd={isActive ? handleTouchEnd : undefined}
      data-testid={`movie-card-${movie.id}`}
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt={movie.title}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full bg-muted flex items-center justify-center">
          <Film className="w-24 h-24 text-muted-foreground" />
        </div>
      )}
      
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
      
      <div className="absolute bottom-0 left-0 right-0 p-6">
        <h2 className="text-2xl font-bold text-white mb-1 drop-shadow-lg">
          {movie.title}
        </h2>
        <div className="flex items-center gap-3 text-white/80 text-sm">
          {movie.year && <span>{movie.year}</span>}
          {movie.rating && (
            <span className="flex items-center gap-1">
              <span className="text-yellow-400">★</span>
              {movie.rating.toFixed(1)}
            </span>
          )}
        </div>
        {movie.genres.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {movie.genres.slice(0, 3).map((genre) => (
              <span
                key={genre}
                className="px-2 py-1 bg-white/20 backdrop-blur-sm rounded-md text-xs text-white/90"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
      </div>

      {isActive && dragOffset.x !== 0 && (
        <>
          <div
            className="absolute top-8 left-8 px-4 py-2 border-4 border-red-500 rounded-lg transform -rotate-12"
            style={{ opacity: Math.min(1, -dragOffset.x / 100) }}
          >
            <span className="text-2xl font-bold text-red-500">PASS</span>
          </div>
          <div
            className="absolute top-8 right-8 px-4 py-2 border-4 border-green-500 rounded-lg transform rotate-12"
            style={{ opacity: Math.min(1, dragOffset.x / 100) }}
          >
            <span className="text-2xl font-bold text-green-500">LIKE</span>
          </div>
        </>
      )}
    </div>
  );
}
