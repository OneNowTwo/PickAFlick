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

      {/* Main spotlight 1 - center right */}
      <div 
        className="absolute"
        style={{
          width: '45vw',
          height: '55vh',
          left: '30%',
          top: '15%',
          background: `
            radial-gradient(ellipse 60% 70% at center,
              hsl(45 100% 95% / 0.15) 0%,
              hsl(350 90% 70% / 0.7) 15%,
              hsl(350 85% 55% / 0.5) 35%,
              hsl(350 80% 40% / 0.2) 55%,
              hsl(350 70% 30% / 0.05) 75%,
              transparent 100%
            )
          `,
          animation: 'spotlight-drift-1 18s ease-in-out infinite',
          filter: 'blur(8px)',
        }}
      />
      {/* Glow layer for spotlight 1 */}
      <div 
        className="absolute"
        style={{
          width: '55vw',
          height: '65vh',
          left: '25%',
          top: '10%',
          background: `
            radial-gradient(ellipse 60% 70% at center,
              hsl(350 80% 50% / 0.3) 0%,
              hsl(350 75% 40% / 0.15) 40%,
              transparent 70%
            )
          `,
          animation: 'spotlight-drift-1 18s ease-in-out infinite',
          filter: 'blur(30px)',
        }}
      />

      {/* Main spotlight 2 - left side */}
      <div 
        className="absolute"
        style={{
          width: '35vw',
          height: '45vh',
          left: '5%',
          top: '25%',
          background: `
            radial-gradient(ellipse 55% 65% at center,
              hsl(45 100% 95% / 0.12) 0%,
              hsl(350 90% 68% / 0.6) 15%,
              hsl(350 85% 52% / 0.4) 35%,
              hsl(350 80% 38% / 0.15) 55%,
              hsl(350 70% 28% / 0.03) 75%,
              transparent 100%
            )
          `,
          animation: 'spotlight-drift-2 22s ease-in-out infinite',
          filter: 'blur(6px)',
        }}
      />
      {/* Glow layer for spotlight 2 */}
      <div 
        className="absolute"
        style={{
          width: '45vw',
          height: '55vh',
          left: '0%',
          top: '20%',
          background: `
            radial-gradient(ellipse 55% 65% at center,
              hsl(350 80% 48% / 0.25) 0%,
              hsl(350 75% 38% / 0.1) 40%,
              transparent 70%
            )
          `,
          animation: 'spotlight-drift-2 22s ease-in-out infinite',
          filter: 'blur(25px)',
        }}
      />

      {/* Main spotlight 3 - right bottom */}
      <div 
        className="absolute"
        style={{
          width: '38vw',
          height: '48vh',
          left: '55%',
          top: '35%',
          background: `
            radial-gradient(ellipse 58% 68% at center,
              hsl(45 100% 95% / 0.1) 0%,
              hsl(350 90% 65% / 0.5) 15%,
              hsl(350 85% 50% / 0.35) 35%,
              hsl(350 80% 36% / 0.12) 55%,
              hsl(350 70% 26% / 0.02) 75%,
              transparent 100%
            )
          `,
          animation: 'spotlight-drift-3 25s ease-in-out infinite',
          filter: 'blur(7px)',
        }}
      />
      {/* Glow layer for spotlight 3 */}
      <div 
        className="absolute"
        style={{
          width: '48vw',
          height: '58vh',
          left: '50%',
          top: '30%',
          background: `
            radial-gradient(ellipse 58% 68% at center,
              hsl(350 80% 46% / 0.2) 0%,
              hsl(350 75% 36% / 0.08) 40%,
              transparent 70%
            )
          `,
          animation: 'spotlight-drift-3 25s ease-in-out infinite',
          filter: 'blur(22px)',
        }}
      />
    </div>
  );
}
