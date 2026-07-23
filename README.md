# ParcelPath customer tracker

A single-purpose customer shipment tracking page for DHL, Aramex, and FedEx.

## Run locally

Open `index.html` for the customer experience. It displays sample tracking data if `/api/track` is not deployed.

## Enable live carrier lookups

Deploy the `api/track.js` serverless endpoint (for example, as a Vercel API route), then add the secrets from `.env.example` to the deployment's encrypted environment configuration. Do not publish carrier credentials in the browser or commit them to Git.

After deployment, verify that `https://YOUR-DOMAIN/api/health` returns JSON. If it returns Vercel's `NOT_FOUND` page, the project was deployed from the wrong repository/root directory or has not been redeployed with the `api/` folder and `package.json` included.

The DHL and FedEx routes are wired to their production APIs. Aramex is intentionally left as a provider adapter until the account's SOAP/REST setup details are supplied; its API setup is account-specific.

For FedEx, set `FEDEX_ENVIRONMENT=sandbox` during testing and change it to `production` (or omit it) only when you have production credentials. The connector supports `client_credentials`, `csp_credentials`, and `client_pc_credentials`; the latter two require the corresponding `FEDEX_CHILD_KEY` and `FEDEX_CHILD_SECRET` values.

The FedEx tracking request sends `X-locale` (default `en_US`) and requests detailed scans. Change `FEDEX_LOCALE` only when a different FedEx-supported response locale is required.

## Shipment creation module

The Business portal can create a ParcelPath ID (`PP-YYYY-#####`) and optionally link a DHL, Aramex, or FedEx waybill. In this lightweight version, created shipments are stored in the browser's local storage and can be tracked with either ID from that same browser. Before using it with real customers or staff, connect the creation module to a database and protect the Business portal with authentication.
