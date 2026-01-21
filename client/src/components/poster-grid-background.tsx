export function PosterGridBackground() {
  return (
    <div 
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
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
              from 0deg at 30% 40%,
              transparent 0deg,
              hsl(45 100% 95% / 0.25) 4deg,
              hsl(45 100% 90% / 0.15) 8deg,
              hsl(45 90% 85% / 0.05) 15deg,
              transparent 25deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-1 8s ease-in-out infinite',
          filter: 'blur(15px)',
        }}
      />

      <div 
        className="absolute w-[200%] h-[200%] -left-1/2 -top-1/2"
        style={{
          background: `
            conic-gradient(
              from 180deg at 70% 45%,
              transparent 0deg,
              hsl(45 100% 95% / 0.20) 3deg,
              hsl(45 100% 90% / 0.12) 7deg,
              hsl(45 90% 85% / 0.04) 12deg,
              transparent 20deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-2 10s ease-in-out infinite',
          filter: 'blur(18px)',
        }}
      />

      <div 
        className="absolute w-[200%] h-[200%] -left-1/2 -top-1/2"
        style={{
          background: `
            conic-gradient(
              from 270deg at 50% 35%,
              transparent 0deg,
              hsl(45 100% 95% / 0.18) 3deg,
              hsl(45 100% 90% / 0.10) 6deg,
              hsl(45 90% 85% / 0.03) 12deg,
              transparent 18deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-3 12s ease-in-out infinite',
          filter: 'blur(20px)',
        }}
      />
    </div>
  );
}
