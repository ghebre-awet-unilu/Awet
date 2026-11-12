# LuxeHome Real Estate

A property website for Luxembourg with online booking and an admin panel.

| Part | Folder | Technology |
|---|---|---|
| Website (frontend) | `luxehome/` | Hugo static site + plain JavaScript |
| API (backend) | `booking_api/` | Node.js, Express |
| Database | Supabase | PostgreSQL |
| Payments | PayPal | REST Orders API v2 |
| Email | Gmail SMTP | Nodemailer |

## Features

- **Property listings** loaded live from the database, with search and filters by type and status.
- **Property pages** at `/property/?id=N`, with photos, specs and an optional video.
- **Booking with PayPal.** The guest enters their name and email and pays on PayPal. When they return, the payment is captured and the booking is marked **paid**.
  - Rentals pay the first month's rent.
  - Sales pay a reservation deposit (`SALE_DEPOSIT_EUR`).
  - The price is always calculated on the server, so it can't be changed in the browser.
- **Contact form** that emails each enquiry to the admin.
- **Admin panel** at `/admin/`:
  - Login with a signed session token that expires after 8 hours.
  - Password setup and reset by email link.
  - Dashboard with live numbers: properties, bookings, paid bookings and revenue.
  - Properties: add, edit and delete listings, upload an image, and set featured. Changes are saved to the database and show up on the website immediately.
  - Bookings: shows every booking with its payment status (Paid, Awaiting payment, Cancelled, Failed).

## Run it locally

You need **Node.js 18+** and **Hugo (extended)**.

### 1. Database (only once)
In Supabase, open **SQL Editor**, paste [`booking_api/schema.sql`](booking_api/schema.sql) and click **Run**.

### 2. API
```bash
cd booking_api
npm install
cp .env.example .env      # then fill in the values (see comments in the file)
npm run import-properties # first time only: copies the Markdown properties into the DB
npm start                 # API on http://localhost:3000
```
To check that it works, open http://localhost:3000/api/health. It should show `"db": true`.

### 3. Website
```bash
cd luxehome
hugo server --baseURL http://localhost:1313/luxehome/ --appendPort=false
```
Then open http://localhost:1313/luxehome/

### 4. First admin login
1. Set `ADMIN_EMAIL` in `.env`.
2. Open http://localhost:1313/luxehome/admin/ and click **"Email me a setup link"**.
3. Open the link from the email and choose a password (min. 8 characters). If email is not configured, the link is printed in the API terminal instead.
4. Log in.

## Configuration

| Where | Setting | Meaning |
|---|---|---|
| `luxehome/hugo.toml` | `apiBase` | Address of the API used by the website |
| `luxehome/hugo.toml` | `saleDeposit` | Deposit shown to visitors (keep equal to `SALE_DEPOSIT_EUR`) |
| `booking_api/.env` | `SITE_URL` | Website address (used for PayPal return links and emails) |
| `booking_api/.env` | `ALLOWED_ORIGINS` | Websites that are allowed to call the API |
| `booking_api/.env` | `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` for testing, `https://api-m.paypal.com` for real money |

**Testing payments:** use **sandbox** keys from developer.paypal.com together with a sandbox buyer account. With live keys, real money is charged.

## API endpoints

| Method | Path | Access |
|---|---|---|
| GET | `/api/health` | public |
| GET | `/api/properties`, `/api/properties/:id` | public |
| POST | `/api/contact` | public (rate limited) |
| POST | `/api/paypal/create-order` | public (rate limited, price from DB) |
| POST | `/api/paypal/capture-order`, `/api/paypal/cancel-order` | public (needs PayPal order id) |
| POST | `/api/admin/login` | public (rate limited) |
| POST | `/api/admin/send-setup-link` | public, but the link only goes to `ADMIN_EMAIL` |
| POST | `/api/admin/setup-password` | needs a valid email token |
| GET | `/api/admin/me` | admin |
| GET | `/api/bookings`, `/api/bookings/:id` | admin |
| POST/PUT/DELETE | `/api/properties[/:id]` | admin |

Admin requests send `Authorization: Bearer <token>`. The token comes from `/api/admin/login`.

## Deploying online

The website is deployed to GitHub Pages by `.github/workflows/hugo.yml`. Booking, contact and admin only work there if the **API is also online** (for example on Render or Railway) **over https**. After deploying the API:
1. Set `apiBase` in `hugo.toml` to the API's https address.
2. On the API server, set `SITE_URL` to the GitHub Pages address and add that address to `ALLOWED_ORIGINS`.

## Security notes
- Never commit `booking_api/.env`. It is listed in `.gitignore`. Use `.env.example` as a template.
- Passwords are hashed with bcrypt.
- All write and booking-data endpoints require an admin token.
- Login, contact and booking requests are rate limited.
