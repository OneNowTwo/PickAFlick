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
            radial-gradient(ellipse 100% 70% at 50% 30%, 
              hsl(345 82% 45% / 0.35) 0%,
              hsl(345 82% 40% / 0.20) 30%,
              hsl(345 82% 35% / 0.08) 60%,
              transparent 85%
            )
          `,
        }}
      />
      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 70% 50% at 50% 25%, 
              hsl(0 0% 100% / 0.08) 0%,
              hsl(0 0% 100% / 0.03) 40%,
              transparent 70%
            )
          `,
        }}
      />
    </div>
  );
}
