import { createDb, resetAll, type Db, type Queryable } from './db'

// Starting the embedded database takes a few seconds, so each test process starts it once and
// every test file section empties it instead of starting another.
let shared: Promise<Db> | undefined

/** The shared in-memory database. Pass false to keep what is in it. */
export async function testDb(reset = true): Promise<Db> {
  shared ??= createDb({})
  const db = await shared
  if (reset) await resetAll(db)
  return db
}

/** Inserts a bare order so rows that point at it (escrow, disputes, courier tasks) are valid. */
export async function seedOrder(q: Queryable, id: string, fields: { customerPhone?: string } = {}): Promise<void> {
  await q.query(
    `INSERT INTO orders (id, customer_phone, title, subject, status, customer_total, scribe_payout, pages, words, delivery_otp, final_deadline)
     VALUES ($1,$2,'t','s','Paid',100,60,1,100,'123456','soon') ON CONFLICT DO NOTHING`,
    [id, fields.customerPhone ?? null],
  )
}
