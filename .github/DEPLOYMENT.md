# 🚀 Deployment Guide

This guide covers deployment options for PickAFlick.

## Table of Contents
- [Railway](#railway-recommended)
- [Render](#render)
- [Heroku](#heroku)
- [Docker](#docker)
- [Manual Deployment](#manual-deployment)

---

## Railway (Recommended)

Railway offers easy deployment with automatic PostgreSQL setup.

### Setup

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway**
   ```bash
   railway login
   ```

3. **Create a new project**
   ```bash
   railway init
   ```

4. **Add PostgreSQL database**
   ```bash
   railway add --plugin postgresql
   ```

5. **Set environment variables**
   ```bash
   railway variables set NODE_ENV=production
   railway variables set TMDB_API_KEY=your_tmdb_key
   railway variables set AI_INTEGRATIONS_OPENAI_API_KEY=your_openai_key
   railway variables set CATALOGUE_TTL_HOURS=24
   ```

6. **Deploy**
   ```bash
   railway up
   ```

7. **Run database migrations**
   ```bash
   railway run npm run db:push
   ```

### Automatic Deployment with GitHub Actions

1. Get your Railway token:
   ```bash
   railway whoami --token
   ```

2. Add the token to GitHub Secrets:
   - Go to your repository → Settings → Secrets and variables → Actions
   - Create a new secret named `RAILWAY_TOKEN`
   - Paste your Railway token

3. Push to main branch - automatic deployment will trigger!

---

## Render

Render provides free tier hosting with PostgreSQL support.

### Setup

1. **Create a new Web Service** on [render.com](https://render.com)

2. **Connect your GitHub repository**
   - Select "PickAFlick" repository
   - Choose the `main` branch

3. **Configure Build Settings**
   - **Build Command**: `npm install && npm run build && npm run db:push`
   - **Start Command**: `npm start`
   - **Node Version**: 18.x or higher

4. **Add PostgreSQL Database**
   - Create a new PostgreSQL database in Render
   - Copy the internal database URL

5. **Set Environment Variables**
   ```
   NODE_ENV=production
   DATABASE_URL=<your_render_postgres_url>
   TMDB_API_KEY=<your_key>
   AI_INTEGRATIONS_OPENAI_API_KEY=<your_key>
   PORT=5000
   CATALOGUE_TTL_HOURS=24
   ```

6. **Deploy**
   - Click "Create Web Service"
   - Render will automatically build and deploy
   - Subsequent pushes to `main` will auto-deploy

---

## Heroku

### Setup

1. **Install Heroku CLI**
   ```bash
   npm install -g heroku
   ```

2. **Login to Heroku**
   ```bash
   heroku login
   ```

3. **Create a new app**
   ```bash
   heroku create your-pickaflick-app
   ```

4. **Add PostgreSQL**
   ```bash
   heroku addons:create heroku-postgresql:mini
   ```

5. **Set environment variables**
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set TMDB_API_KEY=your_key
   heroku config:set AI_INTEGRATIONS_OPENAI_API_KEY=your_key
   heroku config:set CATALOGUE_TTL_HOURS=24
   ```

6. **Deploy**
   ```bash
   git push heroku main
   ```

7. **Run migrations**
   ```bash
   heroku run npm run db:push
   ```

---

## Docker

Deploy using Docker containers.

### Dockerfile

Create a `Dockerfile` in the project root:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY server ./server
COPY shared ./shared

EXPOSE 5000
CMD ["npm", "start"]
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/pickaflick
      - TMDB_API_KEY=${TMDB_API_KEY}
      - AI_INTEGRATIONS_OPENAI_API_KEY=${AI_INTEGRATIONS_OPENAI_API_KEY}
      - PORT=5000
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=pickaflick
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Deploy

```bash
docker-compose up -d
docker-compose exec app npm run db:push
```

---

## Manual Deployment

Deploy to any VPS (DigitalOcean, AWS EC2, etc.)

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Nginx (recommended)
- PM2 (process manager)

### Steps

1. **SSH into your server**
   ```bash
   ssh user@your-server-ip
   ```

2. **Install dependencies**
   ```bash
   sudo apt update
   sudo apt install nodejs npm postgresql nginx
   npm install -g pm2
   ```

3. **Set up PostgreSQL**
   ```bash
   sudo -u postgres createdb pickaflick
   sudo -u postgres psql
   CREATE USER pickaflick_user WITH PASSWORD 'secure_password';
   GRANT ALL PRIVILEGES ON DATABASE pickaflick TO pickaflick_user;
   \q
   ```

4. **Clone and build**
   ```bash
   git clone https://github.com/OneNowTwo/PickAFlick.git
   cd PickAFlick
   npm install
   npm run build
   ```

5. **Set up environment**
   ```bash
   cp .env.example .env
   nano .env  # Edit with your values
   ```

6. **Run database migrations**
   ```bash
   npm run db:push
   ```

7. **Start with PM2**
   ```bash
   pm2 start npm --name "pickaflick" -- start
   pm2 save
   pm2 startup
   ```

8. **Configure Nginx** (optional, for custom domain)
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

---

## Environment Variables Checklist

Before deploying, ensure all these variables are set:

- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL=postgresql://...`
- [ ] `TMDB_API_KEY=...`
- [ ] `AI_INTEGRATIONS_OPENAI_API_KEY=...`
- [ ] `PORT=5000` (or your platform's required port)
- [ ] `CATALOGUE_TTL_HOURS=24`

---

## Post-Deployment Checklist

After deploying:

1. [ ] Verify the app is accessible at your deployment URL
2. [ ] Test movie swipe functionality
3. [ ] Test trailer playback
4. [ ] Test AI recommendations
5. [ ] Check error logs for any issues
6. [ ] Set up monitoring (optional: Railway/Render have built-in monitoring)
7. [ ] Configure custom domain (optional)
8. [ ] Set up SSL certificate (most platforms auto-provision this)

---

## Troubleshooting

### Build fails with "Out of memory"
- Increase the build instance size in your hosting provider
- Or set `NODE_OPTIONS=--max-old-space-size=4096`

### Database connection errors
- Verify `DATABASE_URL` is correct
- Check if your database accepts connections from your app's IP
- Ensure database exists and migrations have run

### API key errors
- Double-check environment variables are set correctly
- Verify API keys are valid and not expired
- Check API rate limits haven't been exceeded

### Port issues
- Some platforms (Heroku, Railway) set `PORT` automatically
- Ensure your app reads from `process.env.PORT`

---

## Need Help?

- Check the [main README](../README.md) for basic setup
- Open an issue on [GitHub](https://github.com/OneNowTwo/PickAFlick/issues)
- Review logs from your hosting provider
