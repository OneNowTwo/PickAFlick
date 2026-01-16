# PickAFlick Design Guidelines

## Design Approach
**Reference-Based: Tinder-Inspired Card Interface**

Drawing from Tinder's proven swipe interaction model while adapting for movie discovery. The interface prioritizes large, immersive movie posters with minimal UI chrome, creating a focused decision-making experience.

## Core Design Principles
- **Poster-First**: Movie posters are the hero element, displayed prominently
- **Minimal Distraction**: Dark backgrounds recede, letting content shine
- **Immediate Action**: Clear, accessible swipe controls
- **Smooth Flow**: Seamless card transitions and trailer browsing

---

## Layout System

### Spacing Primitives
Use Tailwind units: **2, 4, 6, 8, 12, 16** for consistent rhythm
- Tight spacing: p-2, gap-2
- Standard spacing: p-4, p-6, gap-4
- Section spacing: p-8, p-12
- Large gaps: p-16

### Main Layout Structure

**Swipe Card Section** (Primary viewport)
- Centered card stack occupying 70-80% of viewport height
- Card dimensions: Portrait aspect ratio (2:3) for movie posters
- Desktop: max-w-md (448px) card width
- Mobile: Full width minus 16px padding each side
- Vertical centering with flex layout

**Trailer Section** (Below cards or sidebar on wide screens)
- Horizontal scrollable strip on mobile/tablet
- 2-3 column grid on desktop (lg:)
- Each trailer card: 16:9 aspect ratio for YouTube embeds

**Control Buttons**
- Position below card on mobile/tablet
- Side-by-side buttons on desktop (Pass/Like)
- Fixed bottom position or inline below card

---

## Typography

### Font Stack
**Primary**: 'Inter' or 'Manrope' from Google Fonts - clean, modern sans-serif
**Accent**: 'Outfit' for headings if personality needed

### Hierarchy
- **Card Title** (Movie name): text-2xl font-bold (on card overlay or below)
- **Metadata** (Year, genre): text-sm font-medium
- **Section Headers**: text-xl font-semibold (e.g., "Recommended Trailers")
- **UI Labels**: text-base font-medium
- **Helper Text**: text-sm

---

## Component Design

### Movie Card (Swipeable)
```
Structure:
- Full-bleed poster image (TMDb w500 or w780)
- Dark gradient overlay from bottom (0% to 80% opacity)
- Movie title + year in white over gradient
- Subtle shadow/elevation for card depth
- Rounded corners: rounded-2xl
- Card exits with rotation + slide animation on swipe

States:
- Default: Slight elevation (shadow-xl)
- Hover: Subtle lift (scale-105 transition)
- Swipe Left: Rotate -15deg + translate-x-[-100vw]
- Swipe Right: Rotate 15deg + translate-x-[100vw]
```

### Swipe Controls
**Button Pair Below Card:**
- **Pass Button**: Large circular button (w-16 h-16), X icon, subtle red accent on hover
- **Like Button**: Large circular button, Heart/Check icon, subtle green accent on hover
- Spacing: gap-8 between buttons
- Icon size: w-8 h-8

**Shuffle Button** (Secondary action):
- Top-right corner or bottom center
- Icon: Refresh/Shuffle symbol
- Smaller size: w-12 h-12
- Text label optional on desktop

### Trailer Strip/Carousel

**Mobile/Tablet:**
- Horizontal scroll container (overflow-x-auto, snap-x)
- Each trailer: min-w-[280px] w-[85vw] max-w-sm
- Gap: gap-4
- Snap to start of each card

**Desktop (lg:):**
- Grid: grid-cols-2 lg:grid-cols-3
- Equal height cards
- Gap: gap-6

**Trailer Card Structure:**
- 16:9 aspect ratio container
- YouTube iframe embed (rounded-lg)
- Movie title below iframe (text-sm truncate)
- "Trailer unavailable" placeholder: Centered text in aspect-ratio box with icon

### Navigation/Header (Minimal)
- **Logo/App Name**: Top-left, text-xl font-bold
- Optional stats counter: "5 left" in top-right
- Height: h-16, fixed position optional
- Transparent or subtle dark background

---

## Visual Treatment

### Dark Theme Palette
(Colors will be specified later, but structure):
- **Background**: Very dark, near-black
- **Cards**: Pure white posters on dark surface
- **Text**: High contrast white/light gray
- **Accents**: Subtle for Pass (red undertone) / Like (green undertone)
- **Overlays**: Black gradient 0-80% opacity

### Elevation & Depth
- Card stack: Multiple cards visible behind (scale-95, scale-90, opacity-50)
- Active card: shadow-2xl
- Trailer cards: shadow-lg
- Buttons: shadow-md with hover shadow-lg

### Animations
**Card Swipe:**
- Spring physics for natural feel
- Rotation + translation
- Duration: 300-400ms
- Next card slides up smoothly

**Trailer Scroll:**
- Smooth scroll-snap
- Fade-in on load

**Button Feedback:**
- Scale-95 on press
- Quick transition-all duration-150

---

## Responsive Behavior

**Mobile (base to md:):**
- Single column layout
- Full-width card (minus padding)
- Buttons below card
- Trailer strip: Horizontal scroll
- Touch-optimized swipe gestures

**Tablet (md: to lg:):**
- Larger card size
- 2-column trailer grid option
- More generous spacing

**Desktop (lg:+):**
- Max-width card centered
- 3-column trailer grid
- Side-by-side Pass/Like buttons with labels
- Optional: Keyboard shortcuts (Arrow keys)

---

## Images

### Movie Posters
- Source: TMDb image API (w500 for cards, w780 for high-res)
- Always use poster_path, never backdrop for main cards
- Fallback: Gray placeholder with film icon if missing

### Trailer Thumbnails
- YouTube auto-generates from embed
- No custom thumbnails needed

### Background
- Solid dark color, no patterns
- Optional: Subtle radial gradient (dark center to slightly lighter edges)

---

## Key Interaction Patterns

1. **Swipe Decision Flow**: Card → Swipe/Tap → Next card appears → Continue
2. **Trailer Discovery**: Scroll/browse recommendations → Tap to play → YouTube fullscreen available
3. **Shuffle**: Single tap → All cards + trailers refresh → Restart from first card
4. **Empty State**: When cards run out → "That's all! Shuffle for more" message with large shuffle button