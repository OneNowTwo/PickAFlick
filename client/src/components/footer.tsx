export function Footer() {
  return (
    <footer className="relative z-10 w-full border-t border-border/40 bg-background/80 backdrop-blur py-8 mt-4">
      <div className="w-full max-w-7xl mx-auto px-4 flex flex-col items-center gap-3">
        <img src="/logo.png" alt="WhatWeWatching" className="w-36 md:w-44 h-auto opacity-80" />
        <p className="text-xs text-muted-foreground/60">
          © 2026 <a href="https://whatwewatching.com.au" className="hover:text-muted-foreground transition-colors">whatwewatching.com.au</a> — All rights reserved.
        </p>
      </div>
    </footer>
  );
}
