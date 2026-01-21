export function PosterGridBackground() {
  return (
    <div 
      className="absolute inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      <div 
        className="absolute inset-0"
        style={{
          background: `
            repeating-linear-gradient(
              90deg,
              hsl(350 70% 12%) 0px,
              hsl(350 65% 15%) 2px,
              hsl(350 70% 10%) 4px,
              hsl(350 60% 14%) 8px,
              hsl(350 70% 11%) 12px,
              hsl(350 65% 13%) 16px
            )
          `,
        }}
      />
      
      <div 
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(
              180deg,
              transparent 0%,
              hsl(350 70% 8% / 0.3) 30%,
              hsl(350 70% 5% / 0.5) 70%,
              hsl(350 70% 3% / 0.7) 100%
            )
          `,
        }}
      />

      <div 
        className="absolute w-[200%] h-[200%] -left-1/2 -top-1/2"
        style={{
          background: `
            conic-gradient(
              from 0deg at 30% 20%,
              transparent 0deg,
              hsl(45 100% 95% / 0.12) 8deg,
              hsl(45 100% 90% / 0.08) 15deg,
              transparent 25deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-1 12s ease-in-out infinite',
        }}
      />

      <div 
        className="absolute w-[200%] h-[200%] -left-1/2 -top-1/2"
        style={{
          background: `
            conic-gradient(
              from 180deg at 70% 25%,
              transparent 0deg,
              hsl(45 100% 95% / 0.10) 6deg,
              hsl(45 100% 90% / 0.06) 12deg,
              transparent 20deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-2 15s ease-in-out infinite',
        }}
      />

      <div 
        className="absolute w-[200%] h-[200%] -left-1/2 -top-1/2"
        style={{
          background: `
            conic-gradient(
              from 90deg at 50% 15%,
              transparent 0deg,
              hsl(45 100% 95% / 0.08) 5deg,
              hsl(45 100% 90% / 0.05) 10deg,
              transparent 18deg,
              transparent 360deg
            )
          `,
          animation: 'spotlight-sweep-3 18s ease-in-out infinite',
        }}
      />

      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 100% 80% at 50% 100%, 
              hsl(0 0% 0% / 0.8) 0%,
              transparent 70%
            )
          `,
        }}
      />
    </div>
  );
}
