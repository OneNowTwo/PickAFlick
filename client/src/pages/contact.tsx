import { Link } from "wouter";
import { PosterGridBackground } from "@/components/poster-grid-background";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Film, Bookmark, Mail } from "lucide-react";

export default function Contact() {
  return (
    <div className="min-h-screen w-full">
      <PosterGridBackground />
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-7xl mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/">
            <a className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -ml-2 transition-colors" data-testid="button-logo-home">
              <img src="/logo.png" alt="WhatWeWatching" className="h-12 md:h-14 w-auto" />
            </a>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/watchlist?from=contact">
              <Button variant="ghost" className="gap-2" data-testid="button-watchlist">
                <Bookmark className="w-4 h-4" />
                <span className="hidden sm:inline">My Watchlist</span>
              </Button>
            </Link>
            <Link href="/">
              <Button variant="ghost" className="gap-2" data-testid="button-home">
                <Film className="w-4 h-4" />
                <span className="hidden sm:inline">Home</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-7xl mx-auto px-4 py-12 min-h-[60vh]">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h1 className="text-3xl md:text-4xl font-bold text-white">Contact Us</h1>
          <p className="text-lg text-white/90">
            We&apos;re building WhatWeWatching to make movie night easier.
          </p>
          <p className="text-base text-white/80">
            Have feedback, ideas, or found a bug? We&apos;d love to hear from you.
          </p>
          <a
            href="mailto:feedback@whatwewatching.com.au"
            className="inline-flex items-center gap-2 text-primary hover:underline font-medium text-lg"
          >
            <Mail className="w-5 h-5" />
            feedback@whatwewatching.com.au
          </a>
          <p className="text-sm text-white/70">We usually reply within 24 hours.</p>
          <Link href="/">
            <Button variant="default" className="mt-4 gap-2">
              <Film className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
