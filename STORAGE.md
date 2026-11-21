# Storage plan

How ScribeLink keeps customer files without the bill or the risk growing forever.

## The idea in one line

Keep files only as long as someone needs them, then delete them. The database stores *facts* (small); object storage holds *files* (big) and is emptied on a schedule.

## What we store

| File | Size | Who reads it | Kept for |
|------|------|--------------|----------|
| Customer notes (PDF, photo, text) | up to 20 MB, usually 1-5 MB | the customer, the assigned scribe (after accepting), admins | 7 days after the order is Closed or Cancelled |
| Dispute evidence video | up to 100 MB | the customer, admins | 30 days after the order is Closed |
| Handwriting sample photo | up to 9 MB | public (shown on scribe cards) | until the scribe replaces it |
| Anything not attached to an order | any | the uploader | 24 hours, then deleted |

Everything else (orders, money, timeline) is rows in PostgreSQL and is small: a few KB per order.

## How big does it get?

Because of the deletion rules, storage is set by *recent* orders, not by all orders ever. Rough numbers (assumptions: notes average 3 MB, 5% of orders have a dispute video of about 40 MB):

| Orders per month | Notes on disk (7 days) | Videos on disk (30 days) | Total |
|------------------|------------------------|--------------------------|-------|
| 1,000 | under 1 GB | about 2 GB | about 3 GB |
| 20,000 | about 14 GB | about 40 GB | about 55 GB |
| 100,000 | about 70 GB | about 200 GB | about 270 GB |

Object storage costs a few rupees per GB per month, so even the last row is a small bill. Check the provider's current price before launch. The real risk is not cost. It is holding other people's notes longer than needed, so deletion is built in.

## Where files live

- **Now (built):** a folder on the API server (`UPLOAD_DIR`). Each file has a row in the `files` table with its owner, order, type, size and `delete_after`.
- **Production (Phase 19):** an S3-compatible bucket, private. Cloudflare R2 is a good fit (no download fees); AWS S3 in the Mumbai region also works. The code talks to a small `FileStore` interface (`src/backend/files.ts`), so changing store means writing one new class.
- A server folder is lost when the server is replaced, so **do not launch on it**. Use the bucket.

## Rules the code follows (built)

1. A file belongs to the person who uploaded it. Nobody else can attach it to an order.
2. An upload with no order is deleted after 24 hours.
3. When an order becomes Closed or Cancelled, its notes get a 7-day timer and its evidence a 30-day timer.
4. A scheduled job (`/api/cron/trigger-jobs`, run every hour) deletes expired files: bytes first, then the row.
5. A scribe can read the notes only after accepting the order, and only while it is theirs. After reassignment they lose access.
6. Notes are never cached (`Cache-Control: no-store`) and are served only with sign-in.

## Next steps (in order)

1. **Bucket store** (Phase 19): add an S3/R2 `FileStore`. Files are named by random id, never by the customer's file name.
2. **Direct uploads:** today the API receives the whole file in memory (up to 100 MB). Move to short-lived upload links so the browser sends files straight to the bucket and the API only records them.
3. **Signed download links** that expire in a few minutes, instead of streaming through the API.
4. **Bucket rules as a backstop:** a lifecycle rule that deletes anything older than 45 days, in case the job ever fails.
5. **Smaller files:** resize phone photos in the browser before upload (about 1 MB is plenty for reading); cap dispute videos at 60 seconds.
6. **Encrypt at rest** (bucket setting) and **block public access** on the bucket.
7. **Backups:** back up the database daily. Do not back up customer files past their retention, or the deletion promise is false.
8. **Tell people:** the privacy policy (Phase 18) must state these retention periods. Add a "delete my data now" button for customers.
