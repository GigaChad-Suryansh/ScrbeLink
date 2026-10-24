import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

const PREFIX = 'scribelink.v1.'

/** useState that survives a page reload. Falls back to plain state if storage is blocked. */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      /* storage unavailable: keep working in memory */
    }
  }, [key, value])
  return [value, setValue]
}

/** Wipes saved demo data so the app starts from its seed data again. */
export function resetDemoData(): void {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k))
    Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => sessionStorage.removeItem(k))
  } catch {
    /* nothing to clear */
  }
}
