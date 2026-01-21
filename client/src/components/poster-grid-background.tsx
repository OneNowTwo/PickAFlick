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
          width: '55vw',
          height: '65vh',
          left: '20%',
          top: '15%',
          background: `
            radial-gradient(ellipse at center,
              hsl(350 85% 65% / 0.9) 0%,
              hsl(350 80% 55% / 0.6) 25%,
              hsl(350 75% 45% / 0.3) 50%,
              hsl(350 70% 35% / 0.1) 70%,
              transparent 90%
            )
          `,
          animation: 'spotlight-drift-1 15s ease-in-out infinite',
          filter: 'blur(40px)',
        }}
      />

      <div 
        className="absolute"
        style={{
          width: '45vw',
          height: '55vh',
          left: '40%',
          top: '25%',
          background: `
            radial-gradient(ellipse at center,
              hsl(350 85% 60% / 0.7) 0%,
              hsl(350 80% 50% / 0.45) 25%,
              hsl(350 75% 40% / 0.2) 50%,
              hsl(350 70% 30% / 0.08) 70%,
              transparent 90%
            )
          `,
          animation: 'spotlight-drift-2 18s ease-in-out infinite',
          filter: 'blur(35px)',
        }}
      />

      <div 
        className="absolute"
        style={{
          width: '40vw',
          height: '50vh',
          left: '10%',
          top: '30%',
          background: `
            radial-gradient(ellipse at center,
              hsl(350 85% 62% / 0.6) 0%,
              hsl(350 80% 52% / 0.4) 25%,
              hsl(350 75% 42% / 0.18) 50%,
              hsl(350 70% 32% / 0.06) 70%,
              transparent 90%
            )
          `,
          animation: 'spotlight-drift-3 20s ease-in-out infinite',
          filter: 'blur(38px)',
        }}
      />
    </div>
  );
}
