import './testSetup'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { testDb } from './testDb'
import { inbox, markAllRead, messagesFor, notifyOnce, notifyOrderEvent } from './notify'

describe('notifications', () => {
  test('each event produces one message per person, and a repeat is ignored', async () => {
    const db = await testDb()
    await db.query(`INSERT INTO scribes (scribe_id, phone, name, college, tag, sample_card_text) VALUES ('S-1','+919800000002','Asha','DTU','S-1','x')`)
    const order = { id: 'ORD-1', status: 'Delivered', customerPhone: '+919800000001', scribeId: 'S-1' }
    await notifyOrderEvent(db, order, 'Delivered')
    await notifyOrderEvent(db, order, 'Delivered') // retried request, second cron run
    assert.equal((await inbox(db, '+919800000001')).items.length, 1)
    assert.equal((await inbox(db, '+919800000002')).items.length, 1)
  })

  test('the inbox counts unread and clears on read', async () => {
    const db = await testDb()
    await notifyOnce(db, 'k1', '+919800000003', 'ORDER_PAID', 'hello')
    assert.equal(await notifyOnce(db, 'k1', '+919800000003', 'ORDER_PAID', 'hello'), false)
    assert.equal((await inbox(db, '+919800000003')).unread, 1)
    await markAllRead(db, '+919800000003')
    assert.equal((await inbox(db, '+919800000003')).unread, 0)
    assert.equal((await inbox(db, '+919800000009')).items.length, 0) // nobody else sees it
  })

  test('statuses with nothing to say send nothing', () => {
    assert.deepEqual(messagesFor({ id: 'A', status: 'x' }, 'Dispatched'), [])
  })
})
