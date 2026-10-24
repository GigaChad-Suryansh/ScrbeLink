import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

/** Fades and lifts its content into view once, as it scrolls on screen. Shows immediately if motion is reduced. */
export default function Reveal({ as: Tag = 'div', className = '', delay = 0, children }: {
  as?: ElementType
  className?: string
  delay?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!el || reduce || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <Tag ref={ref} className={`reveal${shown ? ' in' : ''} ${className}`.trim()} style={{ '--d': `${delay}ms` } as React.CSSProperties}>
      {children}
    </Tag>
  )
}
