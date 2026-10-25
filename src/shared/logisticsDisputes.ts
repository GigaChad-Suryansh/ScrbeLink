/**
 * shared/logisticsDisputes.ts
 * Types and business logic for Phase 6:
 * 1. Courier Integration (Porter / Borzo)
 * 2. Unboxing Video Dispute Flow
 * 3. WhatsApp / SMS Notification engine
 * 4. Admin Management (card verification, disputes, strikes)
 */

export interface CourierTask {
  trackingId: string
  courierPartner: 'Borzo' | 'Porter'
  orderId: string
  pickupAddress: string
  dropGate: string
  courierRiderName: string
  courierRiderPhone: string
  deliveryOtp: string
  gateDropPhotoUrl?: string
  status: 'ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED_AT_GATE' | 'FAILED'
  createdAt: string
  deliveredAt?: string
}

export interface DisputeRecord {
  id: string
  orderId: string
  openedByUserId: string
  customerName: string
  scribeId: string
  scribeName: string
  amount: number
  reason: 'ILLEGIBLE_HANDWRITING' | 'MISSING_PAGES' | 'DAMAGED_ENVELOPE' | 'INCORRECT_DIAGRAMS' | 'OTHER'
  unboxingVideoUrl: string
  customerNotes: string
  scribeResponse?: string
  status: 'PENDING_REVIEW' | 'REFUNDED_TO_CUSTOMER' | 'RELEASED_TO_SCRIBE' | 'SPLIT'
  adminNotes?: string
  openedAt: string
  resolvedAt?: string
}

export interface NotificationLog {
  id: string
  channel: 'WHATSAPP' | 'SMS'
  recipient: string
  templateName: string
  content: string
  sentAt: string
  status: 'DELIVERED' | 'SENT'
}

export interface AdminScribeApproval {
  scribeId: string
  name: string
  college: string
  tag: string
  sampleCardText: string
  handwritingSampleUrl: string
  isApproved: boolean
  strikes: number
  isSuspended: boolean
  /** Fields below exist for scribes who signed up themselves. */
  phone?: string
  upiVpa?: string
  specialties?: string[]
}
