// Iconic movie scene backdrops — scattered across the FULL viewport as a mosaic.
// 5 columns × 4 rows = 20 tiles, staggered so no dead space anywhere.
// Backdrop paths verified via TMDb API (w780, 16:9).
const MOVIE_SCENES = [
  // Column 1 — far left
  { title: "The Dark Knight",          backdrop: "/dqK9Hag1054tghRQSqLSfrkvQnA.jpg", top: "0%",   left: "0%",  anim: "logo-float-1 20s ease-in-out infinite" },
  { title: "Pulp Fiction",             backdrop: "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg", top: "26%",  left: "0%",  anim: "logo-float-3 22s ease-in-out infinite" },
  { title: "The Godfather",            backdrop: "/tSPT36ZKlP2WVHJLM4cQPLSzv3b.jpg", top: "52%",  left: "0%",  anim: "logo-float-7 21s ease-in-out infinite" },
  { title: "Mad Max: Fury Road",       backdrop: "/l0eIS009XtEO80aC6zjM3o3AkEl.jpg", top: "78%",  left: "0%",  anim: "logo-float-11 20s ease-in-out infinite" },
  // Column 2 — left-centre
  { title: "Inception",                backdrop: "/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg", top: "13%",  left: "21%", anim: "logo-float-2 24s ease-in-out infinite" },
  { title: "Fight Club",               backdrop: "/xRyINp9KfMLVjRiO5nCsoRDdvvF.jpg", top: "39%",  left: "21%", anim: "logo-float-9 22s ease-in-out infinite" },
  { title: "Parasite",                 backdrop: "/hiKmpZMGZsrkA3cdce8a7Dpos1j.jpg", top: "65%",  left: "21%", anim: "logo-float-10 27s ease-in-out infinite" },
  { title: "The Matrix",               backdrop: "/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg", top: "88%",  left: "21%", anim: "logo-float-5 26s ease-in-out infinite" },
  // Column 3 — centre
  { title: "Interstellar",             backdrop: "/2ssWTSVklAEc98frZUQhgtGHx7s.jpg", top: "0%",   left: "42%", anim: "logo-float-4 19s ease-in-out infinite" },
  { title: "Blade Runner 2049",        backdrop: "/askFH4GSk2u9z3ZE5ypdKIMeqLJ.jpg", top: "26%",  left: "42%", anim: "logo-float-8 25s ease-in-out infinite" },
  { title: "Avengers: Endgame",        backdrop: "/7RyHsO4yDXtBv1zUU3mTpHeQ0d5.jpg", top: "52%",  left: "42%", anim: "logo-float-12 24s ease-in-out infinite" },
  { title: "The Dark Knight",          backdrop: "/dqK9Hag1054tghRQSqLSfrkvQnA.jpg", top: "78%",  left: "42%", anim: "logo-float-6 23s ease-in-out infinite" },
  // Column 4 — right-centre
  { title: "The Shawshank Redemption", backdrop: "/zfbjgQE1uSd9wiPTX4VzsLi0rGG.jpg", top: "13%",  left: "63%", anim: "logo-float-6 23s ease-in-out infinite" },
  { title: "Inception",                backdrop: "/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg", top: "39%",  left: "63%", anim: "logo-float-2 24s ease-in-out infinite" },
  { title: "Pulp Fiction",             backdrop: "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg", top: "65%",  left: "63%", anim: "logo-float-3 22s ease-in-out infinite" },
  { title: "Interstellar",             backdrop: "/2ssWTSVklAEc98frZUQhgtGHx7s.jpg", top: "88%",  left: "63%", anim: "logo-float-4 19s ease-in-out infinite" },
  // Column 5 — far right
  { title: "Fight Club",               backdrop: "/xRyINp9KfMLVjRiO5nCsoRDdvvF.jpg", top: "0%",   left: "80%", anim: "logo-float-9 22s ease-in-out infinite" },
  { title: "The Matrix",               backdrop: "/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg", top: "26%",  left: "80%", anim: "logo-float-5 26s ease-in-out infinite" },
  { title: "Mad Max: Fury Road",       backdrop: "/l0eIS009XtEO80aC6zjM3o3AkEl.jpg", top: "52%",  left: "80%", anim: "logo-float-11 20s ease-in-out infinite" },
  { title: "Parasite",                 backdrop: "/hiKmpZMGZsrkA3cdce8a7Dpos1j.jpg", top: "78%",  left: "80%", anim: "logo-float-10 27s ease-in-out infinite" },
];

interface PosterGridBackgroundProps {
  hideLogos?: boolean;
}

export function PosterGridBackground({ hideLogos = false }: PosterGridBackgroundProps) {
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

      {/* Movie scene mosaic — full-viewport tiled backdrops, only on start screen */}
      {!hideLogos && MOVIE_SCENES.map((scene, i) => (
        <div
          key={`${scene.title}-${i}`}
          className="absolute select-none"
          style={{
            top: scene.top,
            left: scene.left,
            opacity: 0.13,
            animation: scene.anim,
          }}
        >
          <img
            src={`https://image.tmdb.org/t/p/w780${scene.backdrop}`}
            alt={scene.title}
            className="rounded-lg object-cover"
            style={{
              width: 'clamp(200px, 21vw, 340px)',
              aspectRatio: '16/9',
            }}
            draggable={false}
          />
        </div>
      ))}
    </div>
  );
}
