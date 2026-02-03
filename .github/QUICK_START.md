# 🚀 Quick Start Guide

Get PickAFlick running in 5 minutes!

## Prerequisites

Install these first:
- [Node.js 18+](https://nodejs.org/)
- [PostgreSQL](https://www.postgresql.org/download/)

Get these API keys:
- [TMDB API Key](https://www.themoviedb.org/settings/api) - Free, instant approval
- [OpenAI API Key](https://platform.openai.com/api-keys) - Requires account

## Setup (5 minutes)

```bash
# 1. Clone and install (1 min)
git clone https://github.com/OneNowTwo/PickAFlick.git
cd PickAFlick
npm install

# 2. Set up environment (1 min)
cp .env.example .env
# Edit .env and add your API keys

# 3. Set up database (1 min)
createdb pickaflick
npm run db:push

# 4. Start development server (2 min)
npm run dev
# Open http://localhost:5000
```

## Common Commands

```bash
# Development
npm run dev              # Start dev server with hot reload

# Database
npm run db:push          # Update database schema
createdb pickaflick      # Create database (first time only)

# Production
npm run build            # Build for production
npm start                # Run production server

# Type checking
npm run check            # Check TypeScript types
```

## Troubleshooting

### "Database connection failed"
- Make sure PostgreSQL is running: `brew services start postgresql` (macOS)
- Check DATABASE_URL in `.env` matches your PostgreSQL setup

### "TMDB API error"
- Verify your TMDB_API_KEY in `.env` is correct
- Check you've activated the API key on TMDB website

### "OpenAI error"
- Verify your OpenAI API key in `.env`
- Check you have credits in your OpenAI account

### Port already in use
- Change PORT in `.env` to a different number (e.g., 5001)
- Or kill the process: `lsof -ti:5000 | xargs kill -9`

## Next Steps

1. ✅ App running? Try swiping on some movies!
2. 📖 Read the [full README](../README.md) for detailed documentation
3. 🚀 Ready to deploy? Check [DEPLOYMENT.md](DEPLOYMENT.md)
4. 🤝 Want to contribute? See [CONTRIBUTING.md](../CONTRIBUTING.md)

## Getting Help

- 📚 Check the [README](../README.md) for detailed documentation
- 🐛 Found a bug? [Open an issue](https://github.com/OneNowTwo/PickAFlick/issues)
- 💬 Have questions? [Start a discussion](https://github.com/OneNowTwo/PickAFlick/discussions)

---

Happy movie discovering! 🎬✨
