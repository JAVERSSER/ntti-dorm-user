# DormPay — User payment form

A public page with no login. The resident:

1. chooses their **Room**, types their **Student name**, and chooses their **Grade** (Year 1–5) and **Student at** (school),
2. scans the dormitory's **ABA QR** shown on the page and pays,
3. uploads a **screenshot** of the payment and submits.

The submission is saved in Supabase (`payment_submissions` table plus the private `payment-slips` storage bucket) and appears right away on the admin's **Payments** page. The resident gets a short reference code.

The Room and School lists and the QR image come from the database, so admins manage them in the admin app. If no QR has been uploaded, the form shows `public/payment/qr.jpg`.

## Setup

The database is set up by the admin app's migrations (`../admin/supabase/migrations`). Apply those first.

```bash
cp .env.example .env.local   # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server only)
npm install
npm run dev
```

## Safety

- The service-role key is used only on the server (`server-only`). It never reaches the browser.
- Uploads must be real JPG, PNG or WEBP files (the server checks the file's bytes) and at most 5 MB. Large photos are shrunk in the browser before upload.
- The server checks that the room and school are real, active choices. A hidden honeypot field drops simple bots.
