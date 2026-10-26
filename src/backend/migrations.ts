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
]
