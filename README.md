# FundBloom API

## Description

FundBloom API is the Express/Node backend for the FundBloom crowdfunding platform. It exposes versioned REST endpoints for Firebase session exchange, role-based access, campaigns, contributions, credit purchases, withdrawals, notifications, analytics, reports, and optional email delivery. MongoDB is the source of truth for users, campaigns, balances, payments, and audit ledgers.

## Live project and resources

- Live frontend: [crowdfunding-client-indol.vercel.app](https://crowdfunding-client-indol.vercel.app)
- Live API health check: [crowdfunding-server-cyan.vercel.app/api/v1/health](https://crowdfunding-server-cyan.vercel.app/api/v1/health)
- Client repository: [github.com/RizviBR0/crowdfunding-client](https://github.com/RizviBR0/crowdfunding-client)
- Server repository: [github.com/RizviBR0/crowdfunding-server](https://github.com/RizviBR0/crowdfunding-server)
- API base path: `https://crowdfunding-server-cyan.vercel.app/api/v1`

## Technologies used

- Node.js 20 and Express 5
- MongoDB native driver 7
- Firebase Admin SDK for identity verification
- JSON Web Tokens for application access tokens
- Stripe Checkout and signed webhooks
- Nodemailer for optional post-transaction email notifications
- Zod for request and environment validation
- Helmet and CORS for HTTP security and origin control
- Vitest and Supertest for automated API/service tests

## Core features

- Firebase email/password and Google session exchange with one-time role-based grants.
- Short-lived application JWTs and MongoDB-authoritative user roles.
- Supporter, Creator, and Admin authorization middleware.
- Approved, active campaign discovery with safe public projections and pagination.
- Creator campaign creation, owner-scoped editing, and transactional soft deletion.
- Atomic contribution reservation, validation, idempotency, approval, rejection, and refunds.
- Immutable credit ledger entries for financial balance changes.
- Server-owned Stripe packages: 100/$10, 300/$25, 800/$60, and 1500/$110.
- Signature-verified Stripe webhook processing that credits supporters exactly once.
- Creator withdrawal reservation and Admin approval/rejection with ledger protection.
- Recipient-scoped notifications with read and read-all endpoints.
- Supporter reports and Admin dismiss, suspend, or delete resolution flows.
- Role-specific supporter, creator, and admin analytics endpoints.
- Optional Nodemailer notifications with bounded retry handling and safe disabled behavior.
- Vercel-compatible API entrypoint and production CORS configuration.

## Dependencies

Runtime dependencies include `express`, `mongodb`, `firebase-admin`, `jsonwebtoken`, `stripe`, `nodemailer`, `zod`, `cors`, `helmet`, and `dotenv`.

Development dependencies include ESLint, Vitest, and Supertest.

## API route groups

All routes are under `/api/v1`:

| Group | Purpose |
| --- | --- |
| `/health` | Process and database readiness |
| `/auth` | Firebase session exchange, current user, and logout |
| `/campaigns` | Public discovery, details, creator mutations, and contributions |
| `/creator` | Creator contribution review, earnings, and withdrawal history |
| `/supporter` | Supporter contribution and payment history |
| `/payments` | Credit packages, Stripe Checkout, webhook, and payment status |
| `/withdrawals` | Creator withdrawal requests |
| `/admin` | Campaigns, users, withdrawals, and reports |
| `/notifications` | Recipient-scoped listing and read actions |
| `/analytics` | Supporter, Creator, and Admin dashboard metrics |

## Run locally

### Prerequisites

- Node.js 20 or newer
- MongoDB Atlas or a MongoDB replica set; credit-changing workflows use transactions
- Firebase Admin service-account configuration
- Stripe test-mode keys for credit purchases and webhooks

### Server setup

```bash
git clone https://github.com/RizviBR0/crowdfunding-server.git
cd crowdfunding-server
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Configure `MONGODB_URI`, `MONGODB_DB_NAME`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `ACCESS_TOKEN_SECRET`, `ADMIN_BOOTSTRAP_EMAILS`, `CLIENT_ORIGIN`, and `CORS_ORIGINS`. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for Stripe flows. SMTP variables are optional.

The local API runs at `http://localhost:5000/api/v1` by default. Check it with:

```bash
curl http://localhost:5000/api/v1/health
```

### Quality checks

```bash
npm run lint
npm test
npm start
```

### Stripe webhook development

Use a Stripe Test mode webhook or Stripe CLI forwarding to `/api/v1/payments/stripe/webhook`. The webhook signing secret must be stored in `STRIPE_WEBHOOK_SECRET`; credits are granted only after signature verification and idempotent payment processing.

## Deployment notes

The repository includes `vercel.json` and `api/index.js` for a Vercel deployment. Set production environment variables in the hosting provider rather than committing them. Configure the deployed client origin in `CLIENT_ORIGIN` and `CORS_ORIGINS`, and use a strong production `ACCESS_TOKEN_SECRET`.

Never commit `.env`, Firebase private keys, MongoDB credentials, Stripe secrets, SMTP passwords, JWT secrets, or real assessment credentials.
