/**
 * Holds the notes file between the upload step and checkout. A File cannot be kept in the
 * saved order state (it is not JSON), so it lives here for the length of the visit.
 */
let current: File | null = null
export const setPendingNotes = (f: File | null) => { current = f }
export const getPendingNotes = () => current
