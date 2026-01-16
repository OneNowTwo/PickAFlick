# PickAFlick - Movie Picker App

## Overview
PickAFlick is a Tinder-style movie picker web app. Users swipe through curated movie posters to decide what to watch, with Pass/Like controls and a shuffle feature. The app sources movies from 5 specific IMDb lists and uses TMDb for movie data, posters, and trailers.

## Current State
- **Frontend**: Fully implemented with swipeable card stack, Pass/Like/Shuffle controls, trailer carousel
- **Backend**: IMDb list scraping, TMDb integration, caching layer, all API endpoints working
- **Integration**: Frontend connected to backend APIs with retry logic and error handling

## Architecture

### Frontend (React + Vite + TypeScript)
- `/client/src/pages/home.tsx` - Main page with card stack and trailer section
- `/client/src/components/movie-card.tsx` - Swipeable movie card with drag gestures
- `/client/src/components/card-stack.tsx` - Card stack manager with swipe logic
- `/client/src/components/swipe-controls.tsx` - Pass/Like/Shuffle buttons
- `/client/src/components/trailer-section.tsx` - Trailer carousel container
- `/client/src/components/trailer-card.tsx` - Individual trailer card with YouTube embed

### Backend (Node.js + Express + TypeScript)
- `/server/routes.ts` - API endpoints (/api/catalogue, /api/recs, /api/trailers, /api/catalogue-all)
- `/server/catalogue.ts` - Movie catalogue service with caching
- `/server/tmdb.ts` - TMDb API integration for movie details and trailers
- `/server/imdb-scraper.ts` - IMDb list scraping

### Shared
- `/shared/schema.ts` - TypeScript types for Movie, CatalogueResponse, etc.

## API Endpoints
- `GET /api/catalogue` - Returns 75 random movies (15 from each of 5 IMDb lists)
- `GET /api/recs?limit=6` - Returns random recommendations from the rec pool
- `GET /api/trailers?ids=1,2,3` - Returns YouTube trailer URLs for given movie IDs
- `GET /api/catalogue-all` - Health status with movie counts

## Environment Variables
- `TMDB_API_KEY` (required) - TMDb API key for movie data
- `CATALOGUE_TTL_HOURS` (optional, default: 24) - How often to rebuild catalogue

## IMDb Lists Used
1. ls094921320 - Top 250 Movies
2. ls003501243 - Best Horror Movies
3. ls002065120 - Classic Movies
4. ls000873904 - Best Comedies
5. ls005747458 - Critically Acclaimed

## Design
- Dark theme with minimalist styling
- Swipeable cards with rotation and slide animations
- Large circular Pass (red) and Like (green) buttons
- Trailer carousel with horizontal scroll on mobile, grid on desktop
- Uses Inter font family for clean modern look

## Development
- Run with `npm run dev`
- Frontend: Vite on port 5000
- Backend: Express on port 5000
- Catalogue builds on startup (takes ~1-2 minutes)
