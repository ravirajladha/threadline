# TODO.md — Deployment & standing tasks

Owner-run work that is not part of a journey stage. Anything here that grows into a real body
of work becomes a stage in `CLAUDE.md` instead.

Last updated: 2026-07-27

---

## Deployment — Railway + Neon + Cloudflare R2

**Decided 2026-07-27.** Chosen over AWS, Vercel and a DigitalOcean droplet on cost and effort:
roughly **$5/month**, no Dockerfile and no CI workflow to maintain, and no serverless cold starts
on an admin panel that is a heavy RSC application.

Why not the alternatives:

| Option | Rejected because |
|---|---|
| Vercel | Hobby tier is **non-commercial only**, so a real store means Pro at $20/user/month plus bandwidth — and bandwidth is the expensive part of a photo-heavy catalog |
| AWS (the original J10 plan) | EC2 + RDS + S3 + CloudFront + IAM is five services and $40+/month to do what one service does |
| DO / Hetzner droplet | Cheapest at ~$5–12, but needs a Dockerfile and a build-and-push pipeline, because a Payload build wants ~8 GB and a small box does not have it |

**J10 still describes the AWS plan and needs rewriting to this.** Do that before starting J10,
not during it.

### Architecture

The storefront and the admin are **one deployment** — Payload 3 is embedded in the Next.js app,
so there is no separate backend service.

| Layer | Where |
|---|---|
| Storefront + admin + API routes | One Railway service |
| Database | Neon (already in use) |
| Media | Cloudflare R2 |
| Test gate | GitHub Actions — `.github/workflows/check.yml` |

**Railway is CD, not CI.** It will happily deploy a build with failing tests; it only cares that
the build compiles. GitHub Actions is what enforces `npm run check`, which is why both exist.

### Status

- [x] Railway account created and connected to GitHub
- [x] GitHub Actions gate committed (`40414b9`)
- [ ] Everything below

### Railway — remaining steps

1. **New Project → Deploy from GitHub repo → `cloth_website`.** It detects Next.js. Let the first
   build run; it is not configured yet, so either outcome is fine.

2. **Variables** tab — copy from `.env.local`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URI` | The Neon connection string |
   | `PAYLOAD_SECRET` | Same as local, or any long random string |
   | `SEED_PASSWORD` | `threadline-dev-seed-2026` |
   | `NODE_ENV` | `production` |

3. **Settings → Deploy → Pre-Deploy Command:**

   ```
   npm run payload migrate
   ```

   Payload owns the schema. A container booting against an un-migrated database fails in
   confusing ways, and this is also what keeps CLAUDE.md's "never migrate production from a dev
   session" rule mechanical rather than a matter of discipline.

4. **Settings → Networking → Generate Domain** — gives a `*.up.railway.app` address, no domain
   purchase needed.

5. Add `NEXT_PUBLIC_SITE_URL` set to that generated URL. `src/lib/seo/metadata.ts` builds
   canonicals and JSON-LD from it and falls back to `localhost:3000` otherwise, so leaving it
   unset ships localhost URLs into the structured data.

6. Run the seed against staging **only after the seed fix has landed** (see below), or the same
   login failure reproduces remotely.

### Cloudflare R2 — remaining steps

Not urgent. Nothing uses R2 until the S3 adapter is wired into `payload.config.ts`, which needs
an `npm install` that has not happened. Until then Payload stores media on local disk.

Cloudflare has no GitHub connection — email login is fine, it is reached by API keys.

1. Dashboard → **R2 Object Storage** → enable. It asks for a payment method even for the free
   tier; nothing is charged under 10 GB.
2. Create a bucket — `threadline-media`.
3. **Manage R2 API Tokens** → create one with **Object Read & Write**.
4. Put these in `.env.local` — never anywhere else, the repo is public:

   | Value | Variable |
   |---|---|
   | Access Key ID | `S3_ACCESS_KEY_ID` |
   | Secret Access Key | `S3_SECRET_ACCESS_KEY` |
   | Bucket name | `S3_BUCKET` |
   | Account ID, from the R2 URL | `S3_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com` |

5. Claude then installs `@payloadcms/storage-s3` and wires it into `payload.config.ts`.

**Why R2 rather than S3 or DO Spaces:** zero egress fees. Product photography *is* the bandwidth
bill for a clothing store, and R2 does not charge for it.

---

## Known issues

- **Staging and local development would share one Neon database.** Anything seeded or edited on
  staging hits the data being developed against. Acceptable for now; the clean fix is a separate
  Neon branch for staging, which is free.
- **`npm run check` is currently red** — see the pending fixes below.

---

## In flight

Dispatched 2026-07-27, may already be resolved — check `git log` before starting either.

- **The seed cannot create a login.** Sample-image generation sits inside the product loop and
  throws, so the seed dies before it reaches account creation. Essential work was made to depend
  on optional work, with no error boundary around the risky part. Fix: accounts first, images
  non-fatal, and find the real `sharp` error rather than swallowing it.
- **`VariantPicker` sets state inside an effect** (`react-hooks/set-state-in-effect`). Derived
  state pretending to be synchronised state; it needs deriving during render. This is what keeps
  `npm run check` red and J3 unticked.
