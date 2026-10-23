/**
 * backend/logisticsService.ts
 * Logistics & Courier Partner Integration (Porter / Borzo simulator):
 * - Creates courier dispatch tasks with gate drop directions
 * - Generates and verifies Delivery OTPs
 * - Handles gate-drop photo uploads and signature proof
 * - Triggers WhatsApp / SMS alerts
 */

import { constantTimeEqual, randomDigits, randomToken } from '../shared/random'
import type { CourierTask, NotificationLog, DisputeRecord, AdminScribeApproval } from '../shared/logisticsDisputes'

export class LogisticsService {
  private courierTasks = new Map<string, CourierTask>()
  private disputes = new Map<string, DisputeRecord>()
  private notifications: NotificationLog[] = []
  private scribeApprovals = new Map<string, AdminScribeApproval>()
  /** Who to message for each order. Falls back to the demo number only when unknown. */
  private customerPhones = new Map<string, string>()
  private phoneFor = (orderId: string) => this.customerPhones.get(orderId) ?? '+919876543210'

  constructor() {
    // Seed sample scribe approvals
    this.scribeApprovals.set('S-2041', {
      scribeId: 'S-2041',
      name: 'Ananya R.',
      college: 'Delhi Technological University (DTU)',
      tag: 'S-2041',
      sampleCardText: "Newton's second law: F = ma. The acceleration of a body is directly proportional to the net force.",
      handwritingSampleUrl: '/samples/s2041.jpg',
      isApproved: true,
      strikes: 0,
      isSuspended: false,
    })

    this.scribeApprovals.set('S-1887', {
      scribeId: 'S-1887',
      name: 'Rohan M.',
      college: 'IIT Delhi',
      tag: 'S-1887',
      sampleCardText: 'The French Revolution began in 1789 with the storming of the Bastille.',
      handwritingSampleUrl: '/samples/s1887.jpg',
      isApproved: true,
      strikes: 1,
      isSuspended: false,
    })

    this.scribeApprovals.set('S-9011', {
      scribeId: 'S-9011',
      name: 'Pooja K.',
      college: 'Netaji Subhas University of Technology (NSUT)',
      tag: 'S-9011',
      sampleCardText: 'Integration by parts formula: uv - integral v du.',
      handwritingSampleUrl: '/samples/s9011.jpg',
      isApproved: false,
      strikes: 0,
      isSuspended: false,
    })

    // Seed sample dispute
    this.disputes.set('DISP-101', {
      id: 'DISP-101',
      orderId: 'SL-7412',
      openedByUserId: 'usr-customer-99',
      customerName: 'Student #4092',
      scribeId: 'S-2041',
      scribeName: 'Ananya R.',
      amount: 248,
      reason: 'MISSING_PAGES',
      unboxingVideoUrl: 'https://storage.scribelink.in/unboxing/SL-7412.mp4',
      customerNotes: 'Page 5 and 6 of Macroeconomics unit 3 were skipped in the envelope.',
      status: 'PENDING_REVIEW',
      openedAt: '3 hours ago',
    })
  }

  // ── Courier Dispatch (Porter / Borzo) ──────────────────────────────────────

  createCourierDispatch(
    orderId: string,
    dropGate = 'Gate 1, DTU Main Campus',
    pickupAddress = 'Hostel Block 4, DTU',
    partner: 'Borzo' | 'Porter' = 'Borzo',
    /** Reuse the order's own OTP so the customer sees one code everywhere. */
    orderOtp?: string,
    customerPhone?: string
  ): CourierTask {
    const trackingId = `${partner.toUpperCase()}-${randomDigits(6)}`
    const deliveryOtp = orderOtp ?? randomDigits(6)
    if (customerPhone) this.customerPhones.set(orderId, customerPhone)

    const task: CourierTask = {
      trackingId,
      courierPartner: partner,
      orderId,
      pickupAddress,
      dropGate,
      courierRiderName: partner === 'Borzo' ? 'Ramesh Kumar (Borzo Rider)' : 'Suraj Singh (Porter Fleet)',
      courierRiderPhone: '+91 98111 22334',
      deliveryOtp,
      status: 'OUT_FOR_DELIVERY',
      createdAt: new Date().toISOString(),
    }

    this.courierTasks.set(orderId, task)

    // Notify Customer via WhatsApp / SMS
    this.sendNotification(
      this.phoneFor(orderId),
      'WHATSAPP',
      'COURIER_DISPATCHED',
      `📦 ScribeLink: Courier ${task.courierRiderName} is on the way to ${dropGate}. Your Delivery OTP is ${deliveryOtp}.`
    )

    return task
  }

  confirmGateDelivery(orderId: string, providedOtp: string, gateDropPhotoUrl?: string): { success: boolean; task?: CourierTask; error?: string } {
    const task = this.courierTasks.get(orderId)
    if (!task) return { success: false, error: 'Courier task not found for order' }

    if (typeof providedOtp !== 'string' || !constantTimeEqual(task.deliveryOtp, providedOtp.trim())) {
      return { success: false, error: 'Invalid Delivery OTP! Handover denied.' }
    }

    task.status = 'DELIVERED_AT_GATE'
    task.deliveredAt = new Date().toISOString()
    task.gateDropPhotoUrl = gateDropPhotoUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="%23e2e8f0"/><text x="150" y="100" font-family="sans-serif" font-size="14" font-weight="bold" fill="%23475569" text-anchor="middle">GATE DROP PHOTO VERIFIED</text></svg>'

    // Alert Customer
    this.sendNotification(
      this.phoneFor(orderId),
      'WHATSAPP',
      'DELIVERY_CONFIRMED',
      `🎉 ScribeLink: Your manuscript has been safely handed over at ${task.dropGate}. 24-hour dispute window has begun.`
    )

    return { success: true, task }
  }

  getCourierTask(orderId: string): CourierTask | undefined {
    return this.courierTasks.get(orderId)
  }

  // ── Unboxing Video Dispute Management ──────────────────────────────────────

  fileDispute(
    orderId: string,
    reason: DisputeRecord['reason'],
    unboxingVideoUrl: string,
    customerNotes: string,
    customerName = 'Student #882',
    scribeId = 'S-2041',
    amount = 350
  ): DisputeRecord {
    const disputeId = `DISP-${randomToken(3)}`
    const dispute: DisputeRecord = {
      id: disputeId,
      orderId,
      openedByUserId: 'usr-cust',
      customerName,
      scribeId,
      scribeName: scribeId,
      amount,
      reason,
      unboxingVideoUrl,
      customerNotes,
      status: 'PENDING_REVIEW',
      openedAt: 'Just now',
    }

    this.disputes.set(disputeId, dispute)

    // Alert Admin & Scribe
    this.sendNotification(
      '+919876543210',
      'SMS',
      'DISPUTE_FILED',
      `⚠️ ScribeLink: A dispute (${disputeId}) was opened on Order #${orderId}. Escrow release is frozen pending video review.`
    )

    return dispute
  }

  resolveDispute(
    disputeId: string,
    decision: 'REFUNDED_TO_CUSTOMER' | 'RELEASED_TO_SCRIBE' | 'SPLIT',
    adminNotes: string
  ): DisputeRecord {
    const dispute = this.disputes.get(disputeId)
    if (!dispute) throw new Error('Dispute record not found')

    dispute.status = decision
    dispute.adminNotes = adminNotes
    dispute.resolvedAt = new Date().toISOString()

    return dispute
  }

  getAllDisputes(): DisputeRecord[] {
    return Array.from(this.disputes.values())
  }

  // ── Admin Panel Operations ─────────────────────────────────────────────────

  verifyScribeCard(scribeId: string, isApproved: boolean): AdminScribeApproval {
    const scribe = this.scribeApprovals.get(scribeId)
    if (!scribe) throw new Error('Scribe not found')
    scribe.isApproved = isApproved
    return scribe
  }

  manageScribeStrike(scribeId: string, delta: number): AdminScribeApproval {
    const scribe = this.scribeApprovals.get(scribeId)
    if (!scribe) throw new Error('Scribe not found')
    scribe.strikes = Math.max(0, scribe.strikes + delta)
    if (scribe.strikes >= 3) {
      scribe.isSuspended = true
    } else {
      scribe.isSuspended = false
    }
    return scribe
  }

  getAllScribes(): AdminScribeApproval[] {
    return Array.from(this.scribeApprovals.values())
  }

  // ── Notification Engine (WhatsApp / SMS) ───────────────────────────────────

  sendNotification(recipient: string, channel: 'WHATSAPP' | 'SMS', templateName: string, content: string): NotificationLog {
    const log: NotificationLog = {
      id: `NOTIF-${Date.now()}-${randomToken(2)}`,
      channel,
      recipient,
      templateName,
      content,
      sentAt: new Date().toLocaleTimeString(),
      status: 'DELIVERED',
    }
    this.notifications.unshift(log)
    return log
  }

  getNotificationLogs(): NotificationLog[] {
    return this.notifications.slice(0, 25)
  }
}

export const globalLogistics = new LogisticsService()
