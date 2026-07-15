# PayVault — Payment Voucher Manager

A minimalist webapp to manage bank statements, extract transactions via AI, and generate/payment vouchers.

## Tech Stack

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend**: Cloudflare Pages Functions (API)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (files)
- **Auth**: Clerk (email code / Gmail)
- **AI**: DeepSeek API (transaction extraction)

## Getting Started

### 1. Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- Cloudflare account
- Clerk account
- DeepSeek API key

### 2. Setup Clerk

1. Go to [clerk.com](https://clerk.com) and create an application
2. Enable **Email Code** and **Google** sign-in strategies
3. Copy the Publishable Key

### 3. Setup Cloudflare

```bash
# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create payvault-db

# Create R2 bucket
wrangler r2 bucket create payvault-storage
```

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
```

Edit `wrangler.toml`:
- Update `database_id` with your D1 database ID
- Add `DEEPSEEK_API_KEY` secret

```bash
wrangler secret put DEEPSEEK_API_KEY
```

### 5. Run Database Migrations

```bash
npm run db:migrate
npm run db:seed
```

### 6. Run Dev Server

```bash
npm install
npm run dev        # Frontend
npm run pages:dev  # Frontend + Functions (local)
```

### 7. Deploy

```bash
npm run deploy
```

Set Clerk publishable key in Cloudflare Pages environment variables.

## Features

- **Bank Statement Upload** — Upload PDF/CSV statements
- **AI Extraction** — DeepSeek extracts debit/credit details automatically
- **Editable Sheet** — Review and correct extracted transactions inline
- **Payment Vouchers** — Generate numbered vouchers with company branding
- **Print & Bundle** — Print individual vouchers or batch-select for merged PDF
- **Multi-Company** — Separate profiles with custom print field visibility
- **Voucher Templates** — Classic, Modern, and Compact layouts
- **Dashboard** — Overview stats and quick actions
- **Audit Trail** — All actions logged automatically
- **Search & Export** — Filter transactions, export to CSV

## Cost Breakdown (Monthly)

| Service | Free Tier | Expected Cost |
|---------|-----------|---------------|
| Cloudflare Pages | Unlimited | $0 |
| Cloudflare D1 | 5GB, 5M reads | $0 |
| Cloudflare R2 | 10GB storage | $0 |
| Clerk | 10k users | $0 |
| DeepSeek API | Pay-as-you-go | ~$0–$2 |

**Total: ~$0–$2/month**
