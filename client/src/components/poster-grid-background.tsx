// Floating streaming service logos
const STREAMING_LOGOS = [
  { name: "Netflix",     logo: "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg", top: "8%",  left: "5%",   size: 96,  anim: "logo-float-1 20s ease-in-out infinite" },
  { name: "Stan",        logo: "/sSfxJXq7s8oHf3XWd0FtqagPDsF.jpg",  top: "22%", right: "4%",  size: 84,  anim: "logo-float-2 24s ease-in-out infinite" },
  { name: "Disney+",     logo: "/97yvRBw1GzX7fXprcF80er19ot.jpg",   top: "42%", left: "4%",   size: 90,  anim: "logo-float-3 22s ease-in-out infinite" },
  { name: "Prime Video", logo: "/pvske1MyAoymrs5bguRfVqYiM9a.jpg",  top: "60%", right: "3%",  size: 84,  anim: "logo-float-4 19s ease-in-out infinite" },
  { name: "Apple TV+",   logo: "/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg",  top: "76%", left: "6%",   size: 84,  anim: "logo-float-5 26s ease-in-out infinite" },
  { name: "Foxtel Now",  logo: "/fejdSG7TwNQ5E0p6u7A6LVs280R.jpg",  top: "30%", right: "5%",  size: 84,  anim: "logo-float-6 23s ease-in-out infinite" },
  { name: "Paramount+",  logo: "/h5DcR0J2EESLitnhR8xLG1QymTE.jpg",  top: "54%", left: "3%",   size: 84,  anim: "logo-float-7 21s ease-in-out infinite" },
  { name: "9Now",        logo: "/xoId9luelz6lXMQkzLyJf3ssXTL.jpg",  top: "85%", right: "6%",  size: 76,  anim: "logo-float-8 25s ease-in-out infinite" },
];

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

      {/* Streaming logos — floating, rendered above gradient layers */}
      {STREAMING_LOGOS.map((logo) => (
        <div
          key={logo.name}
          className="absolute select-none"
          style={{
            top: logo.top,
            left: (logo as any).left,
            right: (logo as any).right,
            opacity: 0.15,
            animation: logo.anim,
          }}
        >
          <img
            src={`https://image.tmdb.org/t/p/w154${logo.logo}`}
            alt={logo.name}
            width={logo.size}
            height={logo.size}
            className="rounded-2xl object-contain"
            draggable={false}
          />
        </div>
      ))}
    </div>
  );
}
