const STEPS = [
  {
    emoji: "🎭",
    title: "Pick your mood",
    description: "Choose one or more genres that match your vibe tonight, or hit Surprise Me for a wild card.",
  },
  {
    emoji: "🎬",
    title: "Trust your gut",
    description: "Two movie posters appear — pick the one that catches your eye. No overthinking required.",
  },
  {
    emoji: "🔁",
    title: "Do it 7 times",
    description: "Each pick teaches us your taste. Seven quick choices is all it takes to dial in your preferences.",
  },
  {
    emoji: "✨",
    title: "Get your picks",
    description: "We serve up your personalised movie recommendations — ranked and ready to watch.",
  },
  {
    emoji: "▶️",
    title: "Watch the trailer",
    description: "Preview any pick instantly with an embedded trailer so you know exactly what you're signing up for.",
  },
  {
    emoji: "📺",
    title: "Find where to stream",
    description: "See exactly which Australian streaming services carry the film and jump straight to it.",
  },
];

// Duplicate for seamless infinite loop
const ALL_STEPS = [...STEPS, ...STEPS];

export function HowToPlaySection() {
  return (
    <div className="w-full py-8 mt-4">
      <h3 className="text-center text-base font-bold uppercase tracking-widest text-white/70 mb-6">
        How to Play
      </h3>

      {/* Marquee container */}
      <div className="overflow-hidden w-full" style={{ maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)' }}>
        <div
          className="flex gap-4"
          style={{
            width: 'max-content',
            animation: 'marquee-scroll 28s linear infinite',
          }}
        >
          {ALL_STEPS.map((step, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-56 rounded-xl p-5 text-left flex flex-col gap-3"
              style={{
                background: 'rgba(0,0,0,0.65)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: 'rgba(220,38,38,0.25)', color: 'hsl(350 75% 65%)', border: '1px solid rgba(220,38,38,0.35)' }}
                >
                  {(i % STEPS.length) + 1}
                </span>
                <span className="text-2xl">{step.emoji}</span>
              </div>
              <h4 className="text-white font-bold text-sm leading-snug">{step.title}</h4>
              <p className="text-white/55 text-xs leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
