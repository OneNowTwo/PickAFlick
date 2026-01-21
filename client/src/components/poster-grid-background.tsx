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

      <div 
        className="absolute"
        style={{
          width: '50vw',
          height: '60vh',
          left: '25%',
          top: '20%',
          background: `
            radial-gradient(ellipse at center,
              hsl(350 80% 55% / 0.5) 0%,
              hsl(350 75% 45% / 0.3) 30%,
              hsl(350 70% 35% / 0.1) 60%,
              transparent 80%
            )
          `,
          animation: 'spotlight-drift-1 15s ease-in-out infinite',
          filter: 'blur(30px)',
        }}
      />

      <div 
        className="absolute"
        style={{
          width: '40vw',
          height: '50vh',
          left: '45%',
          top: '30%',
          background: `
            radial-gradient(ellipse at center,
              hsl(350 80% 50% / 0.4) 0%,
              hsl(350 75% 40% / 0.25) 30%,
              hsl(350 70% 30% / 0.08) 60%,
              transparent 80%
            )
          `,
          animation: 'spotlight-drift-2 18s ease-in-out infinite',
          filter: 'blur(25px)',
        }}
      />

      <div 
        className="absolute"
        style={{
          width: '35vw',
          height: '45vh',
          left: '15%',
          top: '35%',
          background: `
            radial-gradient(ellipse at center,
              hsl(350 80% 52% / 0.35) 0%,
              hsl(350 75% 42% / 0.2) 30%,
              hsl(350 70% 32% / 0.06) 60%,
              transparent 80%
            )
          `,
          animation: 'spotlight-drift-3 20s ease-in-out infinite',
          filter: 'blur(28px)',
        }}
      />
    </div>
  );
}
