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
          filter: 'blur(6px)',
        }}
      />

      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 120% 100% at 50% 50%,
              transparent 0%,
              transparent 30%,
              hsl(0 0% 0% / 0.3) 60%,
              hsl(0 0% 0% / 0.7) 85%,
              hsl(0 0% 0%) 100%
            )
          `,
        }}
      />

      {/* Spotlight 1 - center */}
      <div 
        className="absolute"
        style={{
          width: '50vw',
          height: '60vh',
          left: '25%',
          top: '15%',
          background: `
            radial-gradient(ellipse 50% 55% at center,
              hsl(350 85% 65% / 0.8) 0%,
              hsl(350 80% 55% / 0.6) 20%,
              hsl(350 75% 45% / 0.35) 40%,
              hsl(350 70% 35% / 0.15) 60%,
              hsl(350 65% 25% / 0.05) 80%,
              transparent 100%
            )
          `,
          animation: 'spotlight-drift-1 18s ease-in-out infinite',
          filter: 'blur(15px)',
        }}
      />

      {/* Spotlight 2 - left */}
      <div 
        className="absolute"
        style={{
          width: '40vw',
          height: '50vh',
          left: '5%',
          top: '25%',
          background: `
            radial-gradient(ellipse 48% 52% at center,
              hsl(350 85% 62% / 0.7) 0%,
              hsl(350 80% 52% / 0.5) 20%,
              hsl(350 75% 42% / 0.3) 40%,
              hsl(350 70% 32% / 0.12) 60%,
              hsl(350 65% 22% / 0.04) 80%,
              transparent 100%
            )
          `,
          animation: 'spotlight-drift-2 22s ease-in-out infinite',
          filter: 'blur(12px)',
        }}
      />

      {/* Spotlight 3 - right */}
      <div 
        className="absolute"
        style={{
          width: '42vw',
          height: '52vh',
          left: '50%',
          top: '30%',
          background: `
            radial-gradient(ellipse 46% 50% at center,
              hsl(350 85% 60% / 0.65) 0%,
              hsl(350 80% 50% / 0.45) 20%,
              hsl(350 75% 40% / 0.25) 40%,
              hsl(350 70% 30% / 0.1) 60%,
              hsl(350 65% 20% / 0.03) 80%,
              transparent 100%
            )
          `,
          animation: 'spotlight-drift-3 25s ease-in-out infinite',
          filter: 'blur(14px)',
        }}
      />
    </div>
  );
}
