import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    question: "How does WhatWeWatching work?",
    answer: "You pick a mood or genre, then choose between pairs of movie posters seven times. Each pick trains our algorithm on your taste. We then surface personalised recommendations tailored to what you actually enjoy.",
  },
  {
    question: "Is it free to use?",
    answer: "Completely free. No subscription, no sign-up required. Just open the site and start picking.",
  },
  {
    question: "Do I need to create an account?",
    answer: "No account needed. Your session is saved locally so you can come back to your picks, but we never ask for your email or personal details.",
  },
  {
    question: "Which streaming services do you support?",
    answer: "We show availability across all major Australian streaming platforms including Netflix, Stan, Disney+, Prime Video, Apple TV+, Foxtel Now, Paramount+, Binge, 9Now, ABC iview, SBS On Demand, and more.",
  },
  {
    question: "Can I save movies to watch later?",
    answer: "Yes — tap the bookmark icon on any recommendation to save it to your personal Watchlist. You can come back and browse it any time without losing your picks.",
  },
  {
    question: "How accurate are the recommendations?",
    answer: "Pretty accurate. Seven picks gives us enough signal to understand your mood and taste. The more deliberately you choose, the better the results — trust your gut on those poster picks!",
  },
  {
    question: "Does it work on mobile?",
    answer: "Yes, it's designed mobile-first. Everything works on your phone — picking movies, watching trailers, and jumping straight to a streaming service.",
  },
  {
    question: "What if I don't recognise the movies?",
    answer: "That's the point! Judge the poster like a book cover — go with the vibe, the imagery, or the title. It's surprisingly effective and often surfaces hidden gems you'd never have found scrolling yourself.",
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => setOpenIndex(prev => (prev === i ? null : i));

  return (
    <div className="w-full max-w-2xl mx-auto px-2 py-6">
      <h3 className="text-center text-base font-bold uppercase tracking-widest text-white/70 mb-6">
        Frequently Asked Questions
      </h3>

      <div className="flex flex-col gap-2">
        {FAQS.map((faq, i) => (
          <div
            key={i}
            className="rounded-xl overflow-hidden"
            style={{ background: 'rgba(0,0,0,0.60)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <button
              onClick={() => toggle(i)}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              aria-expanded={openIndex === i}
            >
              <span className="text-white font-medium text-sm">{faq.question}</span>
              <ChevronDown
                className="w-4 h-4 flex-shrink-0 text-white/40 transition-transform duration-300"
                style={{ transform: openIndex === i ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>

            <div
              className="overflow-hidden transition-all duration-300 ease-in-out"
              style={{ maxHeight: openIndex === i ? '200px' : '0px' }}
            >
              <p className="px-5 pb-4 text-white/60 text-sm leading-relaxed">
                {faq.answer}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
