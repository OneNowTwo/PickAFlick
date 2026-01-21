export function PosterGridBackground() {
  return (
    <div 
      className="fixed inset-0 overflow-hidden pointer-events-none -z-10"
      aria-hidden="true"
    >
      <div 
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(90deg,
              hsl(350 60% 8%) 0%,
              hsl(350 70% 18%) 8%,
              hsl(350 65% 12%) 12%,
              hsl(350 75% 22%) 18%,
              hsl(350 70% 15%) 22%,
              hsl(350 65% 10%) 28%,
              hsl(350 75% 20%) 35%,
              hsl(350 70% 14%) 40%,
              hsl(350 80% 25%) 48%,
              hsl(350 75% 18%) 52%,
              hsl(350 70% 12%) 58%,
              hsl(350 75% 20%) 65%,
              hsl(350 65% 14%) 72%,
              hsl(350 70% 18%) 78%,
              hsl(350 65% 12%) 85%,
              hsl(350 70% 16%) 92%,
              hsl(350 60% 8%) 100%
            )
          `,
          filter: 'blur(8px)',
        }}
      />

      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 120% 100% at 50% 50%,
              transparent 0%,
              transparent 30%,
              hsl(0 0% 0% / 0.4) 60%,
              hsl(0 0% 0% / 0.85) 85%,
              hsl(0 0% 0%) 100%
            )
          `,
        }}
      />

      <div 
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(180deg,
              hsl(0 0% 0% / 0.6) 0%,
              transparent 15%,
              transparent 85%,
              hsl(0 0% 0% / 0.7) 100%
            )
          `,
        }}
      />

      <div 
        className="absolute w-[200%] h-[200%] -left-1/2 -top-1/2"
        style={{
          background: `
            conic-gradient(
              from 0deg at 35% 30%,
              transparent 0deg,
              hsl(45 80% 90% / 0.08) 6deg,
              hsl(45 70% 85% / 0.04) 12deg,
              transparent 20deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-1 12s ease-in-out infinite',
          filter: 'blur(20px)',
        }}
      />

      <div 
        className="absolute w-[200%] h-[200%] -left-1/2 -top-1/2"
        style={{
          background: `
            conic-gradient(
              from 180deg at 65% 35%,
              transparent 0deg,
              hsl(45 80% 90% / 0.06) 5deg,
              hsl(45 70% 85% / 0.03) 10deg,
              transparent 18deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-2 15s ease-in-out infinite',
          filter: 'blur(25px)',
        }}
      />

      <div 
        className="absolute w-[200%] h-[200%] -left-1/2 -top-1/2"
        style={{
          background: `
            conic-gradient(
              from 90deg at 50% 25%,
              transparent 0deg,
              hsl(45 80% 90% / 0.05) 4deg,
              hsl(45 70% 85% / 0.02) 8deg,
              transparent 15deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-3 18s ease-in-out infinite',
          filter: 'blur(30px)',
        }}
      />
    </div>
  );
}
