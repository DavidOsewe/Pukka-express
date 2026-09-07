# Pukka Express

Customer tracking site and business portal for Pukka Express shipments, with optional live lookups for DHL, FedEx, and Aramex.

## Pages

| Path | Purpose |
|------|---------|
| `index.html` | Marketing home |
| `services.html` / `routes.html` | Services and routes |
| `tracking.html` | Customer tracker (`app.js`) |
| `admin.html` | Business portal (`admin.js`) — create shipments, publish status updates |

## API routes (Vercel)

| Route | Methods | Auth | Role |
|-------|---------|------|------|
| `/api/health` | GET | Public | Health check |
| `/api/auth` | POST | Public | Admin sign-in via Supabase Auth |
| `/api/shipments` | GET (by tracking number) | Public | Customer tracking of Pukka IDs |
| `/api/shipments` | GET (list) / POST / PATCH | Admin bearer token | Create, list, status updates |
| `/api/track` | GET | Public | Live carrier tracking (`carrier` + `trackingNumber`) |
| `/api/notify-shipment` | POST | Admin bearer token | Resend email on shipment create |

## Setup

1. **Supabase**
   - Create a project and run `supabase/schema.sql` in the SQL editor.
   - Create an Auth user (email/password) for staff.
   - Promote that user:
     ```sql
     insert into public.profiles (id, is_admin)
     values ('PASTE_AUTH_USER_UUID_HERE', true)
     on conflict (id) do update set is_admin = true;
     ```
   - Copy Project URL, anon key, and service-role key into the deployment env.

2. **Environment**  
   Copy `.env.example` into your host’s encrypted environment (Vercel → Project → Settings → Environment Variables). Never commit real secrets.

3. **Deploy**
   - Root of the repo must include `api/`, `package.json`, and the HTML/CSS/JS assets.
   - After deploy, `https://YOUR-DOMAIN/api/health` should return JSON like:
     `{"status":"ok","service":"pukka-express-api",...}`
   - If you see Vercel’s `NOT_FOUND` page, the project was deployed from the wrong root.

4. **Carriers**
   - **DHL**: set `DHL_API_KEY`. Production Track API is used.
   - **FedEx**: set client id/secret. Use `FEDEX_ENVIRONMENT=sandbox` until production credentials are ready. Supports `client_credentials`, `csp_credentials`, and `client_pc_credentials` (child key/secret when required).
   - **Aramex**: credentials are reserved in env; the adapter still needs the account-specific SOAP/REST contract before live calls work. Pukka IDs and manual updates still work.

5. **Email (optional)**
   - Set `RESEND_API_KEY`, a verified `EMAIL_FROM`, and `PUBLIC_SITE_URL`.
   - Only authenticated admins can trigger `/api/notify-shipment`.

## Tracking behaviour

1. Customer enters a number on `tracking.html`.
2. The app first asks `/api/shipments?trackingNumber=...` (Pukka register).
3. If the Pukka row has a linked DHL/FedEx/Aramex waybill, it tries `/api/track` for live scans.
4. On carrier failure, it falls back to the Pukka event timeline.
5. Unknown numbers still attempt carrier auto-detect (FedEx 12/15 digits, Aramex 10 digits, else DHL).

## Local development

Static pages open directly in a browser. API routes need a Node host (e.g. `vercel dev`) with env vars loaded. Without the API, the tracker shows clear configuration errors instead of fake sample data.

## Security notes

- Service-role key is server-only.
- Admin routes require a Supabase access token whose profile has `is_admin = true`.
- RLS is enabled on all tables; no public policies are defined — the service role bypasses RLS for the API.
- Notify endpoint is admin-protected to prevent email abuse.
