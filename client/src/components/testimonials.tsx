import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";

const TESTIMONIALS = [
  {
    name: "Jada S., 24",
    location: "AU",
    quote: "I usually scroll Netflix for 20 minutes and give up. This actually picked something decent in like 10 seconds.",
  },
  {
    name: "Jiet C., 47",
    location: "AU",
    quote: "Didn't expect much, but it nailed my mood pretty quickly. Way better than arguing about what to watch.",
  },
  {
    name: "Renee M., 44",
    location: "AU",
    quote: "The trailer previews are perfect. I don't need 10 options — just a few solid ones.",
  },
  {
    name: "Daniel L., 50",
    location: "AU",
    quote: "Surprisingly good. It feels simple, but it actually works.",
  },
  {
    name: "Hannah B., 44",
    location: "AU",
    quote: "I like that it doesn't overcomplicate things. Pick a vibe and you're done.",
  },
  {
    name: "Carolina M., 59",
    location: "AU",
    quote: "Much easier than browsing every streaming app separately.",
  },
  {
    name: "Ayad S., 43",
    location: "AU",
    quote: "Fast, simple, no fluff. Exactly what movie night needs.",
  },
];

export function TestimonialsSection() {
  const [current, setCurrent] = useState(0);

  // Auto-advance every 5s
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(prev => (prev + 1) % TESTIMONIALS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const prev = () => setCurrent(c => (c - 1 + TESTIMONIALS.length) % TESTIMONIALS.length);
  const next = () => setCurrent(c => (c + 1) % TESTIMONIALS.length);

  const t = TESTIMONIALS[current];

  return (
    <div className="w-full max-w-xl mx-auto px-2 py-4" data-testid="testimonials-section">
      <h3 className="text-center text-sm font-semibold uppercase tracking-widest text-white/40 mb-4">
        What People Are Saying
      </h3>

      {/* Card */}
      <div
        className="relative rounded-xl p-5 md:p-6 text-left"
        style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Stars */}
        <div className="flex gap-0.5 mb-3">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="w-3.5 h-3.5 fill-primary text-primary" />
          ))}
        </div>

        {/* Quote */}
        <p className="text-white/90 text-sm md:text-base leading-relaxed mb-4">
          &ldquo;{t.quote}&rdquo;
        </p>

        {/* Name */}
        <p className="text-white/50 text-xs font-medium">
          — {t.name} ({t.location})
        </p>

        {/* Nav arrows */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={prev}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/20 transition-all"
            aria-label="Previous testimonial"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Dots */}
          <div className="flex gap-1.5">
            {TESTIMONIALS.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`rounded-full transition-all duration-300 ${
                  i === current
                    ? "w-4 h-2 bg-primary"
                    : "w-2 h-2 bg-white/20 hover:bg-white/40"
                }`}
                aria-label={`Testimonial ${i + 1}`}
              />
            ))}
          </div>

          <button
            onClick={next}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/20 transition-all"
            aria-label="Next testimonial"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
