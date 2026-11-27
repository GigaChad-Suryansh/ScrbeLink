/**
 * backend/legal.ts
 * Phase 18: Legal acceptance tracking, DPDP Act data export & erasure,
 * and misuse reporting.
 */

import type { Queryable } from './db'
import { randomToken } from '../shared/random'

export interface LegalAcceptance {
  phone: string
  role: string
  policyVersion: string
  storageConsent: boolean
  acceptedAt: string
}

export async function recordAcceptance(
  q: Queryable,
  phone: string,
  role: string,
  policyVersion: string,
  storageConsent: boolean,
): Promise<void> {
  await q.query(
    `INSERT INTO legal_acceptances (phone, role, policy_version, storage_consent, accepted_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (phone, role, policy_version) DO UPDATE
     SET storage_consent = EXCLUDED.storage_consent,
         accepted_at = now()`,
    [phone, role, policyVersion, storageConsent],
  )
}

export async function getLatestAcceptance(
  q: Queryable,
  phone: string,
  role: string,
): Promise<LegalAcceptance | null> {
  const r = await q.query<Record<string, unknown>>(
    `SELECT phone, role, policy_version, storage_consent, accepted_at
     FROM legal_acceptances
     WHERE phone=$1 AND role=$2
     ORDER BY accepted_at DESC
     LIMIT 1`,
    [phone, role],
  )
  if (!r[0]) return null
  return {
    phone: r[0].phone as string,
    role: r[0].role as string,
    policyVersion: r[0].policy_version as string,
    storageConsent: Boolean(r[0].storage_consent),
    acceptedAt: new Date(r[0].accepted_at as string).toISOString(),
  }
}

export async function exportUserData(q: Queryable, phone: string) {
  const [orders, addresses, tickets, acceptances] = await Promise.all([
    q.query('SELECT id, title, subject, status, pages, customer_total, created_at FROM orders WHERE customer_phone=$1 ORDER BY created_at DESC', [phone]),
    q.query('SELECT id, kind, data, created_at FROM addresses WHERE owner_phone=$1', [phone]),
    q.query('SELECT id, order_id, subject, body, status, reply, created_at FROM tickets WHERE phone=$1', [phone]),
    q.query('SELECT role, policy_version, storage_consent, accepted_at FROM legal_acceptances WHERE phone=$1', [phone]),
  ])
  return {
    exportedAt: new Date().toISOString(),
    phone,
    orders,
    addresses,
    tickets,
    legalAcceptances: acceptances,
  }
}

export async function deleteUserData(q: Queryable, phone: string): Promise<{ anonymizedOrders: number; deletedAddresses: number }> {
  const ord = await q.query<{ id: string }>(
    `UPDATE orders SET customer_phone = NULL WHERE customer_phone = $1 RETURNING id`,
    [phone],
  )
  const addr = await q.query<{ id: string }>(
    `DELETE FROM addresses WHERE owner_phone = $1 RETURNING id`,
    [phone],
  )
  await q.query('DELETE FROM legal_acceptances WHERE phone = $1', [phone])
  return { anonymizedOrders: ord.length, deletedAddresses: addr.length }
}

export interface MisuseReport {
  id: string
  reporterPhone: string
  targetType: string
  targetId: string
  reason: string
  details: string
  status: string
  createdAt: string
}

export async function createMisuseReport(
  q: Queryable,
  reporterPhone: string,
  targetType: string,
  targetId: string,
  reason: string,
  details: string,
): Promise<MisuseReport> {
  const id = `RPT-${randomToken(4).toUpperCase()}`
  const r = await q.query<Record<string, unknown>>(
    `INSERT INTO misuse_reports (id, reporter_phone, target_type, target_id, reason, details)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [id, reporterPhone, targetType, targetId, reason, details],
  )
  return {
    id: r[0].id as string,
    reporterPhone: r[0].reporter_phone as string,
    targetType: r[0].target_type as string,
    targetId: r[0].target_id as string,
    reason: r[0].reason as string,
    details: r[0].details as string,
    status: r[0].status as string,
    createdAt: new Date(r[0].created_at as string).toISOString(),
  }
}

export async function listMisuseReports(q: Queryable): Promise<MisuseReport[]> {
  const rows = await q.query<Record<string, unknown>>(
    'SELECT * FROM misuse_reports ORDER BY created_at DESC LIMIT 100',
  )
  return rows.map((r) => ({
    id: r.id as string,
    reporterPhone: r.reporter_phone as string,
    targetType: r.target_type as string,
    targetId: r.target_id as string,
    reason: r.reason as string,
    details: r.details as string,
    status: r.status as string,
    createdAt: new Date(r.created_at as string).toISOString(),
  }))
}
