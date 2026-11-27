/**
 * backend/migrations.ts
 * The database schema, as ordered migrations. Never edit one that has shipped: add a new one.
 * Each statement is separate because some drivers run only one statement per call.
 */

export interface Migration {
  version: number
  sql: string[]
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE orders (
        seq                bigserial UNIQUE,
        id                 text PRIMARY KEY,
        customer_phone     text,
        title              text NOT NULL,
        subject            text NOT NULL,
        status             text NOT NULL,
        customer_total     numeric(10,2) NOT NULL,
        scribe_payout      numeric(10,2) NOT NULL,
        scribe_id          text,
        scribe_name        text,
        preferred_scribe_id text,
        pages              int NOT NULL,
        words              int NOT NULL,
        delivery_otp       text NOT NULL,
        addons             jsonb NOT NULL DEFAULT '[]',
        pen_style          text NOT NULL DEFAULT '',
        final_deadline     text NOT NULL,
        intake_deadline    timestamptz,
        next_check_in_due  timestamptz,
        timeline           jsonb NOT NULL DEFAULT '[]',
        created_at         timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX orders_customer_idx ON orders (customer_phone)`,
      `CREATE INDEX orders_scribe_idx ON orders (scribe_id)`,
      `CREATE INDEX orders_status_idx ON orders (status)`,

      `CREATE TABLE payments (
        payment_id text PRIMARY KEY,
        order_id   text NOT NULL REFERENCES orders(id),
        intent     jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,

      `CREATE TABLE scribes (
        scribe_id        text PRIMARY KEY,
        phone            text UNIQUE,
        name             text NOT NULL,
        college          text NOT NULL,
        tag              text NOT NULL,
        sample_card_text text NOT NULL,
        sample_image_url text NOT NULL DEFAULT '',
        upi_vpa          text,
        specialties      jsonb NOT NULL DEFAULT '[]',
        is_approved      boolean NOT NULL DEFAULT false,
        created_at       timestamptz NOT NULL DEFAULT now()
      )`,

      // Strikes are kept per scribe id, even for ids that never signed up, so one ledger serves
      // both the rush monitor and the admin panel.
      `CREATE TABLE scribe_strikes (
        scribe_id    text PRIMARY KEY,
        strikes      int NOT NULL DEFAULT 0,
        is_suspended boolean NOT NULL DEFAULT false,
        logs         jsonb NOT NULL DEFAULT '[]'
      )`,

      `CREATE TABLE escrow (
        order_id        text PRIMARY KEY REFERENCES orders(id),
        scribe_id       text NOT NULL,
        amount          numeric(10,2) NOT NULL,
        delivered_at    timestamptz NOT NULL,
        release_due_at  timestamptz NOT NULL,
        is_released     boolean NOT NULL DEFAULT false,
        is_disputed     boolean NOT NULL DEFAULT false,
        dispute_outcome text
      )`,
      `CREATE INDEX escrow_scribe_idx ON escrow (scribe_id)`,

      `CREATE TABLE rush_watches (
        id                bigserial PRIMARY KEY,
        order_id          text NOT NULL REFERENCES orders(id),
        scribe_id         text NOT NULL,
        scribe_name       text NOT NULL,
        next_check_in_due timestamptz NOT NULL,
        is_closed         boolean NOT NULL DEFAULT false
      )`,
      `CREATE INDEX rush_active_idx ON rush_watches (order_id) WHERE NOT is_closed`,

      `CREATE TABLE courier_tasks (
        order_id text PRIMARY KEY REFERENCES orders(id),
        task     jsonb NOT NULL
      )`,

      `CREATE TABLE disputes (
        id         text PRIMARY KEY,
        order_id   text NOT NULL REFERENCES orders(id),
        status     text NOT NULL,
        record     jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX disputes_one_open_idx ON disputes (order_id) WHERE status = 'PENDING_REVIEW'`,

      `CREATE TABLE notifications (
        id         bigserial PRIMARY KEY,
        record     jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,

      `CREATE TABLE withdrawals (
        id         text PRIMARY KEY,
        scribe_id  text NOT NULL,
        amount     numeric(10,2) NOT NULL,
        upi_vpa    text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX withdrawals_scribe_idx ON withdrawals (scribe_id)`,

      `CREATE TABLE audit_log (
        id    bigserial PRIMARY KEY,
        at    timestamptz NOT NULL DEFAULT now(),
        entry text NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    sql: [
      `CREATE TABLE files (
        id           text PRIMARY KEY,
        kind         text NOT NULL,
        type         text NOT NULL,
        size         bigint NOT NULL,
        owner_phone  text NOT NULL,
        order_id     text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        delete_after timestamptz
      )`,
      `CREATE INDEX files_order_idx ON files (order_id)`,
      `CREATE INDEX files_delete_idx ON files (delete_after) WHERE delete_after IS NOT NULL`,
      `ALTER TABLE orders ADD COLUMN notes_file_id text`,
    ],
  },
  {
    version: 3,
    sql: [
      `CREATE TABLE addresses (
        id          text PRIMARY KEY,
        owner_phone text NOT NULL,
        kind        text NOT NULL,
        data        jsonb NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX addresses_owner_idx ON addresses (owner_phone, kind)`,
      `ALTER TABLE orders ADD COLUMN drop_gate jsonb`,
    ],
  },
  {
    version: 4,
    sql: [
      `CREATE TABLE refunds (
        order_id   text PRIMARY KEY REFERENCES orders(id),
        payment_id text NOT NULL,
        amount     numeric(10,2) NOT NULL,
        reason     text NOT NULL,
        status     text NOT NULL,
        gateway_refund_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    ],
  },
  {
    version: 5,
    sql: [
      `ALTER TABLE notifications ADD COLUMN recipient text`,
      `ALTER TABLE notifications ADD COLUMN dedupe_key text`,
      `ALTER TABLE notifications ADD COLUMN read_at timestamptz`,
      `CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL`,
      `CREATE INDEX notifications_recipient_idx ON notifications (recipient, id DESC)`,
    ],
  },
  {
    version: 6,
    sql: [
      `CREATE TABLE ratings (
        order_id   text PRIMARY KEY REFERENCES orders(id),
        scribe_id  text NOT NULL,
        stars      int NOT NULL CHECK (stars BETWEEN 1 AND 5),
        comment    text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX ratings_scribe_idx ON ratings (scribe_id)`,
      `CREATE TABLE tickets (
        id         text PRIMARY KEY,
        order_id   text REFERENCES orders(id),
        phone      text NOT NULL,
        subject    text NOT NULL,
        body       text NOT NULL,
        status     text NOT NULL DEFAULT 'OPEN',
        reply      text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX tickets_phone_idx ON tickets (phone)`,
    ],
  },
  {
    // Phase 16: scribe verification documents, PAN (encrypted), capacity, payout tracking.
    version: 7,
    sql: [
      `ALTER TABLE scribes
        ADD COLUMN pan_encrypted    text,
        ADD COLUMN pan_last4        text,
        ADD COLUMN college_id_url   text,
        ADD COLUMN selfie_url       text,
        ADD COLUMN id_verified      boolean NOT NULL DEFAULT false,
        ADD COLUMN max_pages_today  int NOT NULL DEFAULT 100,
        ADD COLUMN on_vacation      boolean NOT NULL DEFAULT false`,

      `ALTER TABLE withdrawals
        ADD COLUMN provider         text NOT NULL DEFAULT 'simulated',
        ADD COLUMN provider_ref     text,
        ADD COLUMN status           text NOT NULL DEFAULT 'processed',
        ADD COLUMN tds_amount       numeric(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN failure_reason   text`,

      `CREATE TABLE tds_records (
        id           bigserial PRIMARY KEY,
        scribe_id    text NOT NULL,
        fy           text NOT NULL,
        gross_paid   numeric(10,2) NOT NULL DEFAULT 0,
        tds_deducted numeric(10,2) NOT NULL DEFAULT 0,
        updated_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (scribe_id, fy)
      )`,
    ],
  },
  {
    // Phase 18: legal acceptance tracking (DPDP Act) and misuse reports.
    version: 8,
    sql: [
      `CREATE TABLE legal_acceptances (
        phone           text NOT NULL,
        role            text NOT NULL,
        policy_version  text NOT NULL,
        storage_consent boolean NOT NULL DEFAULT false,
        accepted_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (phone, role, policy_version)
      )`,

      `CREATE TABLE misuse_reports (
        id             text PRIMARY KEY,
        reporter_phone text NOT NULL,
        target_type    text NOT NULL,
        target_id      text NOT NULL,
        reason         text NOT NULL,
        details        text NOT NULL DEFAULT '',
        status         text NOT NULL DEFAULT 'OPEN',
        created_at     timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX misuse_reports_status_idx ON misuse_reports (status, created_at DESC)`,
    ],
  },
  {
    // Phase 20: referral codes and customer credits. Credits come out of ScribeLink's share,
    // never the scribe's payout, so orders.scribe_payout is untouched by a discount.
    version: 9,
    sql: [
      `ALTER TABLE orders ADD COLUMN discount numeric(10,2) NOT NULL DEFAULT 0`,
      `CREATE TABLE referral_codes (
        phone      text PRIMARY KEY,
        code       text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE referrals (
        referee_phone  text PRIMARY KEY,
        referrer_phone text NOT NULL,
        status         text NOT NULL DEFAULT 'PENDING',
        rewarded_order text,
        created_at     timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX referrals_referrer_idx ON referrals (referrer_phone)`,
      `CREATE TABLE customer_credits (
        id         text PRIMARY KEY,
        phone      text NOT NULL,
        amount     numeric(10,2) NOT NULL CHECK (amount > 0),
        reason     text NOT NULL,
        order_id   text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX customer_credits_phone_idx ON customer_credits (phone)`,
    ],
  },
]
