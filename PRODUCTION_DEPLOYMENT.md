# NYX Production Self-Hosting Guide & Deployment Manifest

This document specifies the complete production architecture, deployment steps, and configuration required to run **NYX** independently on your own VPS/server with a real production PostgreSQL database.

---

## 1. Environment Variables (`.env`)
Create a production `.env` file on your server. Never commit real secrets.

```env
# Server & Domain Configuration
NODE_ENV=production
PORT=8080
PUBLIC_URL=https://nyx.yourdomain.com

# Database (PostgreSQL)
DATABASE_URL=postgres://nyx_user:SECURE_PASSWORD@localhost:5432/nyx_production

# Better Auth
BETTER_AUTH_SECRET=generate_a_random_secure_32_byte_hex_string
BETTER_AUTH_URL=https://nyx.yourdomain.com

# Email (Gmail SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=nyx.officialsupport@gmail.com
SMTP_PASS=your_gmail_app_password

# AI Multi-Provider Fallback Routing
AI_FALLBACK_ORDER=openrouter,gemini,mistral,openai
OPENROUTER_API_KEY=your_openrouter_key
GEMINI_API_KEY=your_gemini_key
MISTRAL_API_KEY=your_mistral_key
OPENAI_API_KEY=your_openai_key
RUNWAY_API_KEY=your_runway_key
```

---

## 2. Database Setup & Migrations
1. Install PostgreSQL on your server and create the production database:
   ```sql
   CREATE DATABASE nyx_production;
   CREATE USER nyx_user WITH ENCRYPTED PASSWORD 'SECURE_PASSWORD';
   GRANT ALL PRIVILEGES ON DATABASE nyx_production TO nyx_user;
   ```
2. Run database migrations:
   ```bash
   npm run db:migrate
   ```

---

## 3. Building for Production
1. Install dependencies:
   ```bash
   npm install --production=false
   ```
2. Build the web application:
   ```bash
   npm run build
   ```

---

## 4. Running the Production Server
Start the production server via PM2 or systemd:
```bash
npm run preview
```
Or with PM2:
```bash
pm2 start scripts/preview.mjs --name "nyx-production"
```

---

## 5. Nginx Reverse Proxy & HTTPS Configuration
Configure Nginx (`/etc/nginx/sites-available/nyx`) with SSL certificates (via Certbot):

```nginx
server {
    listen 80;
    server_name nyx.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name nyx.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/nyx.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nyx.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 6. Mobile App Production API Connection
In `mobile/src/services/api.ts`, update `API_BASE` to your production domain:
```ts
const API_BASE = 'https://nyx.yourdomain.com';
```
Then build and publish your mobile app using Expo EAS Build:
```bash
cd mobile
npx eas build --platform android
```
