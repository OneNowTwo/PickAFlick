// Blurred streaming service logos scattered in background
const STREAMING_LOGOS = [
  { name: "NETFLIX",     top: "8%",  left: "6%",   rotate: "-12deg", size: "3rem" },
  { name: "STAN",        top: "22%", right: "6%",  rotate: "10deg",  size: "2.8rem" },
  { name: "DISNEY+",     top: "40%", left: "4%",   rotate: "-8deg",  size: "2.6rem" },
  { name: "PRIME VIDEO", top: "60%", right: "5%",  rotate: "14deg",  size: "2.6rem" },
  { name: "APPLE TV+",   top: "74%", left: "7%",   rotate: "-6deg",  size: "2.4rem" },
  { name: "BINGE",       top: "30%", right: "4%",  rotate: "20deg",  size: "2.8rem" },
  { name: "FOXTEL",      top: "84%", right: "8%",  rotate: "-10deg", size: "2.4rem" },
  { name: "PARAMOUNT+",  top: "52%", left: "3%",   rotate: "7deg",   size: "2.4rem" },
];

export function PosterGridBackground() {
  return (
    <div 
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      aria-hidden="true"
    >
      {/* Streaming logos layer */}
      {STREAMING_LOGOS.map((logo) => (
        <div
          key={logo.name}
          className="absolute select-none"
          style={{
            top: logo.top,
            left: (logo as any).left,
            right: (logo as any).right,
            transform: `rotate(${logo.rotate})`,
            fontSize: logo.size,
            fontWeight: 900,
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.38)',
            filter: 'blur(1.5px)',
            fontFamily: 'system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {logo.name}
        </div>
      ))}
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
          width: '75vw',
          height: '85vh',
          left: '15%',
          top: '5%',
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
          filter: 'blur(20px)',
        }}
      />

      {/* Spotlight 2 - left */}
      <div 
        className="absolute"
        style={{
          width: '60vw',
          height: '75vh',
          left: '-5%',
          top: '15%',
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
          filter: 'blur(18px)',
        }}
      />

      {/* Spotlight 3 - right */}
      <div 
        className="absolute"
        style={{
          width: '65vw',
          height: '80vh',
          left: '40%',
          top: '20%',
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
          filter: 'blur(18px)',
        }}
      />
    </div>
  );
}
