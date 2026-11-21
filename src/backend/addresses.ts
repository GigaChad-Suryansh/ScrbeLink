/**
 * backend/addresses.ts
 * Saved places: delivery gates for customers and the pickup address for scribes.
 * An order keeps its own copy of the gate (a snapshot), so editing or deleting a saved
 * address never changes an order that is already in progress.
 */

import type { Queryable } from './db'
import { optStr, phone, str, ValidationError } from './validate'

export type AddressKind = 'gate' | 'pickup'

export interface Address {
  label: string
  college: string
  /** Gate name, building or street line. */
  line: string
  landmark?: string
  pincode: string
  contactName: string
  contactPhone: string
}

export interface SavedAddress extends Address {
  id: string
  kind: AddressKind
}

export const MAX_GATES = 5

export function parseAddress(raw: unknown, name = 'address'): Address {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError(`${name} is required`)
  const b = raw as Record<string, unknown>
  const pincode = str(b.pincode, 'pincode', { max: 6 })
  if (!/^[1-9]\d{5}$/.test(pincode)) throw new ValidationError('pincode must be 6 digits')
  return {
    label: optStr(b.label, 'label', 40) ?? 'Saved place',
    college: str(b.college, 'college', { max: 100 }),
    line: str(b.line, 'gate or street', { max: 120 }),
    landmark: optStr(b.landmark, 'landmark', 120),
    pincode,
    contactName: str(b.contactName, 'contactName', { max: 60 }),
    contactPhone: phone(b.contactPhone, 'contactPhone'),
  }
}

/** One line for couriers and messages. Contact details are not part of it. */
export const addressLine = (a: Pick<Address, 'college' | 'line' | 'landmark' | 'pincode'>) =>
  [a.line, a.landmark, a.college, a.pincode].filter(Boolean).join(', ')

const fromRow = (r: any): SavedAddress => ({ id: r.id, kind: r.kind, ...r.data })

export async function listAddresses(q: Queryable, ownerPhone: string, kind: AddressKind): Promise<SavedAddress[]> {
  return (await q.query('SELECT id, kind, data FROM addresses WHERE owner_phone = $1 AND kind = $2 ORDER BY created_at, id', [ownerPhone, kind])).map(fromRow)
}

export async function getAddress(q: Queryable, id: string, ownerPhone: string): Promise<SavedAddress | undefined> {
  const rows = await q.query('SELECT id, kind, data FROM addresses WHERE id = $1 AND owner_phone = $2', [id, ownerPhone])
  return rows[0] ? fromRow(rows[0]) : undefined
}

/** Customers keep up to MAX_GATES; a scribe has exactly one pickup address, so saving replaces it. */
export async function saveAddress(q: Queryable, id: string, ownerPhone: string, kind: AddressKind, a: Address): Promise<SavedAddress> {
  if (kind === 'pickup') await q.query(`DELETE FROM addresses WHERE owner_phone = $1 AND kind = 'pickup'`, [ownerPhone])
  else if ((await listAddresses(q, ownerPhone, 'gate')).length >= MAX_GATES) throw new ValidationError(`You can save up to ${MAX_GATES} gates. Delete one first.`)
  await q.query('INSERT INTO addresses (id, owner_phone, kind, data) VALUES ($1,$2,$3,$4::jsonb)', [id, ownerPhone, kind, JSON.stringify(a)])
  return { id, kind, ...a }
}

export async function deleteAddress(q: Queryable, id: string, ownerPhone: string): Promise<boolean> {
  return (await q.query('DELETE FROM addresses WHERE id = $1 AND owner_phone = $2 RETURNING id', [id, ownerPhone])).length > 0
}
