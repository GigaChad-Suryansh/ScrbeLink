import './testSetup'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { seedOrder, testDb } from './testDb'
import { addRating, allTickets, closeTicket, lowRatedScribes, openTicket, ratingOf, scribeSummary, ticketsFor } from './feedback'

const order = (db: Awaited<ReturnType<typeof testDb>>, id: string) => seedOrder(db, id)

describe('ratings and tickets', () => {
  test('an order is rated once and the scribe average follows', async () => {
    const db = await testDb()
    await order(db, 'SL-1'); await order(db, 'SL-2')
    assert.equal(await addRating(db, 'SL-1', 'S-1', 5, 'neat'), true)
    assert.equal(await addRating(db, 'SL-1', 'S-1', 1, 'again'), false)
    await addRating(db, 'SL-2', 'S-1', 4, '')
    assert.deepEqual(await scribeSummary(db, 'S-1'), { average: 4.5, count: 2 })
    assert.equal((await ratingOf(db, 'SL-1'))?.stars, 5)
  })

  test('a scribe is flagged only with enough low ratings', async () => {
    const db = await testDb()
    for (let i = 0; i < 4; i++) { await order(db, `L-${i}`); await addRating(db, `L-${i}`, 'S-9', 1, '') }
    assert.equal((await lowRatedScribes(db)).length, 0)
    await order(db, 'L-4'); await addRating(db, 'L-4', 'S-9', 2, '')
    assert.equal((await lowRatedScribes(db))[0]?.scribeId, 'S-9')
  })

  test('tickets open, list for their owner, and close with a reply', async () => {
    const db = await testDb()
    const t = await openTicket(db, '+919800000010', null, 'Late delivery', 'Where is my order?')
    assert.equal((await ticketsFor(db, '+919800000010')).length, 1)
    assert.equal((await ticketsFor(db, '+919800000011')).length, 0)
    const closed = await closeTicket(db, t.id, 'On its way')
    assert.equal(closed?.status, 'CLOSED')
    assert.equal((await allTickets(db))[0]?.reply, 'On its way')
  })
})
