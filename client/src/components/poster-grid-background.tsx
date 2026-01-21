import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CatalogueResponse } from "@shared/schema";

export function PosterGridBackground() {
  const [isVisible, setIsVisible] = useState(false);

  const { data: catalogue } = useQuery<CatalogueResponse>({
    queryKey: ["/api/catalogue"],
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const movies = catalogue?.movies || [];
  
  if (movies.length === 0) {
    return null;
  }

  const posters = movies
    .filter(m => m.posterPath)
    .slice(0, 40)
    .map(m => ({
      id: m.id,
      url: m.posterPath?.startsWith("http") 
        ? m.posterPath 
        : `https://image.tmdb.org/t/p/w300${m.posterPath}`,
      title: m.title,
    }));

  const row1 = posters.slice(0, 10);
  const row2 = posters.slice(10, 20);
  const row3 = posters.slice(20, 30);
  const row4 = posters.slice(30, 40);

  return (
    <div 
      className={`absolute inset-0 overflow-hidden transition-opacity duration-1000 ${isVisible ? "opacity-100" : "opacity-0"}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex flex-col gap-3 py-4" style={{ transform: "rotate(-8deg) scale(1.3)", transformOrigin: "center center" }}>
        <PosterRow posters={row1} direction="left" speed={60} />
        <PosterRow posters={row2} direction="right" speed={50} />
        <PosterRow posters={row3} direction="left" speed={55} />
        <PosterRow posters={row4} direction="right" speed={45} />
      </div>
      
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background/90 to-background" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background" />
      <div className="absolute inset-0 bg-background/60" />
    </div>
  );
}

function PosterRow({ 
  posters, 
  direction, 
  speed 
}: { 
  posters: { id: number; url: string; title: string }[];
  direction: "left" | "right";
  speed: number;
}) {
  const duplicatedPosters = [...posters, ...posters, ...posters];

  return (
    <div className="relative h-36 overflow-hidden">
      <div 
        className="flex gap-3 absolute"
        style={{
          animation: `scroll-${direction} ${speed}s linear infinite`,
          width: "max-content",
        }}
      >
        {duplicatedPosters.map((poster, index) => (
          <div
            key={`${poster.id}-${index}`}
            className="w-24 h-36 flex-shrink-0 rounded-lg overflow-hidden"
          >
            <img
              src={poster.url}
              alt=""
              className="w-full h-full object-cover filter grayscale-[30%] brightness-75"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
