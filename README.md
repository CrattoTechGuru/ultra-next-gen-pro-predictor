# CRATTO CTRL v15.0 — Production Foundation

CRATTO CTRL is a football analytics and prediction platform. It provides statistical estimates, model diagnostics, strategy generation, historical evaluation, accounts, and shareable CRATTO slip codes.

## v15 additions
- Optional PostgreSQL persistence for accounts, sessions, and slips.
- JSON-file fallback remains available for local/testing deployments when `DATABASE_URL` is not set.
- Passwords are stored as scrypt hashes, never plaintext.
- Account sessions can be stored durably in PostgreSQL.
- Shareable `CCTRL-XXXXXXXX` slip codes persist in PostgreSQL when configured.
- Admin summary endpoint protected by `ADMIN_KEY`.
- Existing football-data.org integration and model store retained.

## Render environment variables
Set these in Render, not in GitHub:

- `FOOTBALL_DATA_API_KEY`
- `DATABASE_URL` (recommended for production)
- `DATABASE_SSL=true` unless your database requires otherwise
- `ADMIN_KEY`
- `NODE_ENV=production`

Render recommends environment variables for secrets and database connection strings. Do not commit `.env` files. https://render.com/docs/configure-environment-variables

## Database
You can use Render Postgres or another PostgreSQL provider. Render documents creating and connecting a PostgreSQL database here:
https://render.com/docs/postgresql-creating-connecting

If using a new PostgreSQL database, the application automatically creates its required account/session/slip tables at startup. `schema.sql` is also included for inspection/manual setup.

## Authentication
The application currently supports email/password registration and login. Production deployments should use HTTPS, a durable database, strong admin secrets, and rate limiting before public launch.

Supabase is also a valid future authentication/database option; its Auth system supports password, magic-link, OTP, social login and JWT-based authorization. https://supabase.com/docs/guides/auth

## CRATTO slip codes
A CRATTO code is a platform share code for a saved prediction slip. It is **not** a bookmaker-issued bet code and cannot place a wager by itself. Actual bookmaker account access or bookmaker-issued bet codes require an official bookmaker integration.

## Start

```bash
npm install
npm start
```

The server listens on `0.0.0.0:$PORT` in production.
