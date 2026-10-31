import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createCinema } from '../../cinema/engine'
import { clamp01, damp, smooth, usePrefersReducedMotion } from '../../cinema/motion'

/**
 * PaperTrail cinematic intro — powered by the same raw-WebGL spiral engine
 * as last-commit 8. No Three.js, no R3F, no external dependencies beyond React.
 *
 * The caller supplies `onEnter` which fires when the user clicks "Start Analysing".
 */

const CENTERS = [0, 0.25, 0.5, 0.75, 1] as const
const HALF_WIDTH = 0.13
const RAIL = ['Introduction', 'Evidence', 'Interpretation', 'Traceability', 'Report'] as const

const MILESTONES = [
  {
    kicker: '01 · Milestone',
    word: 'EVIDENCE',
    lede: 'Research claims, straight from the paper.',
    text: 'PaperTrail extracts every experimental claim from your PDF — training procedures, dataset configurations, evaluation metrics and architectural choices. Each becomes a numbered evidence record with its source page.',
  },
  {
    kicker: '02 · Milestone',
    word: 'INTERPRETATION',
    lede: 'Gemma 4 reads the evidence and the code.',
    text: 'Gemma 4 (E4B), running locally via Ollama, receives each claim alongside relevant source-file snippets from the GitHub repository. It identifies which files and lines relate to each claim — and which do not.',
  },
  {
    kicker: '03 · Milestone',
    word: 'TRACEABILITY',
    lede: 'Claims connected to implementations.',
    text: 'Every research claim is traced to Python modules, training configurations, evaluation scripts and supporting evidence. File paths and line numbers are verified against the actual repository — never invented.',
  },
] as const

function local(progress: number, index: number): number {
  return (progress - (CENTERS[index] as number)) / HALF_WIDTH
}

  // React 18 types don't include the `inert` HTML attribute yet — cast via any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inertProp = (active: boolean) => (active ? ({ inert: '' } as any) : {})

interface Props {
  onEnter: () => void
}

export default function IntroScene({ onEnter }: Props) {
  const reduce = usePrefersReducedMotion()
  const [failed, setFailed] = useState(false)
  const staticLayout = reduce || failed
  const stageRef = useRef<HTMLElement>(null)
  const pinRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const depthRef = useRef<HTMLSpanElement>(null)
  const [beat, setBeat] = useState(0)
  const beatRef = useRef(0)

  useEffect(() => {
    const stage = stageRef.current
    const pin = pinRef.current
    const canvas = canvasRef.current
    if (!stage || !pin || !canvas || failed) return

    const lite =
      window.matchMedia('(max-width: 899px)').matches ||
      (navigator.hardwareConcurrency ?? 8) <= 4
    const engine = createCinema(canvas, { lite, onLost: () => setFailed(true) })
    if (!engine) {
      console.warn('PaperTrail: WebGL unavailable — showing static layout.')
      setFailed(true)
      return
    }

    if (reduce) {
      const draw = () => {
        engine.resize()
        engine.render({ progress: 0.1, speed: 0, pointerX: 0, pointerY: 0, time: 4200 })
      }
      draw()
      window.addEventListener('resize', draw)
      return () => {
        window.removeEventListener('resize', draw)
        engine.dispose()
      }
    }

    const words: HTMLElement[] = [...pin.querySelectorAll<HTMLElement>('[data-ms]')]
    const lastWrite: string[] = words.map(() => '')
    document.documentElement.dataset.cinema = '1'

    let stageTop = 0
    let range = 1
    let hh = 0
    const measure = () => {
      hh = document.querySelector('.pt-masthead')?.getBoundingClientRect().height ?? 0
      stageTop = stage.getBoundingClientRect().top + window.scrollY
      range = Math.max(1, stage.offsetHeight - (window.innerHeight - hh))
      engine.resize()
    }
    measure()

    let frame = 0
    let visible = true
    let current = -1
    let velocity = 0
    let px = 0
    let py = 0
    let pvx = 0
    let pvy = 0
    let targetX = 0
    let targetY = 0
    let lastDepth = -1
    let last = performance.now()

    const place = (progress: number) => {
      words.forEach((el, i) => {
        const u = local(progress, i)
        const a = Math.abs(u)
        const opacity = a >= 1 ? 0 : 1 - smooth(clamp01((a - 0.4) / 0.6))
        const z = u < 0 ? u * 760 : u * 520
        const value =
          opacity < 0.004
            ? 'hidden'
            : `${opacity.toFixed(3)}|${z.toFixed(1)}|${(u * -22).toFixed(1)}|${(u * 5).toFixed(2)}`
        if (value === lastWrite[i]) return
        lastWrite[i] = value
        const inner = el.firstElementChild as HTMLElement | null
        if (!inner) return
        if (value === 'hidden') {
          inner.style.visibility = 'hidden'
          inner.style.opacity = '0'
          return
        }
        inner.style.visibility = 'visible'
        inner.style.opacity = opacity.toFixed(3)
        inner.style.transform = `translate3d(0, ${(u * -22).toFixed(1)}px, ${z.toFixed(1)}px) rotateX(${(u * 5).toFixed(2)}deg)`
      })
    }

    const tick = (now: number) => {
      frame = 0
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      const target = clamp01((window.scrollY - (stageTop - hh)) / range)
      if (current < 0) current = target
      else [current, velocity] = damp(current, target, velocity, 0.28, dt)
      ;[px, pvx] = damp(px, targetX, pvx, 0.4, dt)
      ;[py, pvy] = damp(py, targetY, pvy, 0.4, dt)

      const progress = clamp01(current)
      engine.render({ progress, speed: Math.abs(velocity), pointerX: px, pointerY: py, time: now })
      place(progress)

      const depthEl = depthRef.current
      if (depthEl && Math.abs(progress - lastDepth) > 0.0008) {
        lastDepth = progress
        depthEl.style.transform = `scaleX(${progress.toFixed(4)})`
      }
      const next = Math.round(progress * (CENTERS.length - 1))
      if (next !== beatRef.current) {
        beatRef.current = next
        setBeat(next)
      }
      if (visible) frame = requestAnimationFrame(tick)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting)
        if (visible) document.documentElement.dataset.cinema = '1'
        else delete document.documentElement.dataset.cinema
        if (visible && !frame) {
          last = performance.now()
          frame = requestAnimationFrame(tick)
        }
      },
      { rootMargin: '120px 0px' },
    )
    observer.observe(stage)

    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const onPointer = (event: PointerEvent) => {
      const rect = pin.getBoundingClientRect()
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2
      targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2
    }
    const onLeave = () => {
      targetX = 0
      targetY = 0
    }
    if (fine) {
      pin.addEventListener('pointermove', onPointer, { passive: true })
      pin.addEventListener('pointerleave', onLeave)
    }
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(stage)
    const header = document.querySelector('.pt-masthead')
    if (header) resizeObserver.observe(header)
    window.addEventListener('resize', measure)
    frame = requestAnimationFrame(tick)

    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      if (frame) cancelAnimationFrame(frame)
      pin.removeEventListener('pointermove', onPointer)
      pin.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', measure)
      delete document.documentElement.dataset.cinema
      for (const el of words) {
        const inner = el.firstElementChild as HTMLElement | null
        if (inner) inner.removeAttribute('style')
      }
      engine.dispose()
    }
  }, [reduce, failed])

  const hold = (index: number) => !staticLayout && beat !== index

  return (
    <section
      ref={stageRef}
      className={`pt-cine${staticLayout ? ' pt-cine--static' : ''}`}
      aria-label="Introduction: a journey into a repository"
      data-beat={beat}
    >
      <div ref={pinRef} className="pt-cine-pin">
        <canvas ref={canvasRef} className="pt-cine-canvas" aria-hidden="true" hidden={failed} />
        <div className="pt-cine-veil" aria-hidden="true" />

        <div className="pt-ms-layer">
          {/* Beat 0 — Hero */}
          <div
            className="pt-ms pt-ms--intro"
            data-ms
            data-active={beat === 0 || undefined}
            {...inertProp(hold(0))}
          >
            <div className="pt-ms-in">
              <p className="pt-ms-kicker pt-intro-in" style={{ '--d': 0 } as CSSProperties}>
                AI Research-to-Code Traceability
              </p>
              <h1 className="pt-hero-mark" aria-label="PaperTrail">
                {['PAPER', 'TRAIL'].map((word, w) => (
                  <span className="pt-hero-word" aria-hidden="true" key={word}>
                    {[...word].map((ch, i) => (
                      <span
                        className="pt-hero-ch"
                        key={i}
                        style={{ '--i': i + w * 5 } as CSSProperties}
                      >
                        {ch}
                      </span>
                    ))}
                  </span>
                ))}
              </h1>
              <p className="pt-ms-text pt-intro-in" style={{ '--d': 9 } as CSSProperties}>
                Upload a research paper and a GitHub repository URL. PaperTrail traces every
                experimental claim to its source-code evidence — or tells you honestly when it
                cannot find any.
              </p>
              <div className="pt-ms-actions pt-intro-in" style={{ '--d': 11 } as CSSProperties}>
                <button className="pt-btn-light" onClick={onEnter}>
                  Start Analysing
                </button>
                <span className="pt-link-light">Scroll to explore ↓</span>
              </div>
            </div>
          </div>

          {/* Beats 1–3 — EVIDENCE, INTERPRETATION, TRACEABILITY */}
          {MILESTONES.map((item, index) => (
            <div
              className="pt-ms"
              key={item.word}
              data-ms
              data-active={beat === index + 1 || undefined}
              {...inertProp(hold(index + 1))}
            >
              <div className="pt-ms-in" data-tone={index}>
                <p className="pt-ms-kicker">{item.kicker}</p>
                <h2 className="pt-ms-word">{item.word}</h2>
                <p className="pt-ms-lede">{item.lede}</p>
                <p className="pt-ms-text">{item.text}</p>
              </div>
            </div>
          ))}

          {/* Beat 4 — REPORT / Final destination */}
          <div
            className="pt-ms pt-ms--end"
            data-ms
            data-active={beat === 4 || undefined}
            {...inertProp(hold(4))}
          >
            <div className="pt-ms-in">
              <p className="pt-ms-kicker">04 · Report</p>
              <h2 className="pt-ms-word pt-ms-word--end">
                Understand the research.
                <br />
                Find the evidence.
                <br />
                Trace it back to the code.
              </h2>
              <p className="pt-ms-text">
                Supported claims with file references and code snippets. Ambiguous findings with
                honest uncertainty. Missing evidence stated clearly — not silently omitted.
              </p>
              <div className="pt-ms-actions">
                <button className="pt-btn-light" onClick={onEnter}>
                  Start Analysing →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Rail */}
        <ol className="pt-rail" aria-hidden="true">
          {RAIL.map((name, index) => (
            <li key={name} data-on={beat === index || undefined}>
              <span className="pt-rail-tick" />
              <span className="pt-rail-name">{name}</span>
            </li>
          ))}
        </ol>

        {/* Scroll cue */}
        <p className="pt-scroll-cue" aria-hidden="true" data-hide={beat > 0 || undefined}>
          <span>Scroll to enter</span>
          <span className="pt-scroll-line" />
        </p>

        {/* Depth bar */}
        <div className="pt-depth" aria-hidden="true">
          <span className="pt-depth-label">Depth</span>
          <span className="pt-depth-track">
            <span ref={depthRef} className="pt-depth-fill" />
          </span>
        </div>

        {/* Skip */}
        <button
          className="pt-skip-btn"
          onClick={onEnter}
          aria-label="Skip introduction and open the app"
        >
          Skip intro →
        </button>
      </div>
    </section>
  )
}
