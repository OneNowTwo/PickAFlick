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
            radial-gradient(ellipse 80% 50% at 50% 40%, 
              hsl(345 82% 45% / 0.15) 0%,
              hsl(345 82% 45% / 0.08) 25%,
              hsl(345 82% 45% / 0.03) 50%,
              transparent 70%
            )
          `,
        }}
      />
      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 40% at 50% 35%, 
              hsl(0 0% 100% / 0.03) 0%,
              transparent 60%
            )
          `,
        }}
      />
    </div>
  );
}
