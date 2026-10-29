import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { autoUpdate, offset, shift, useFloating } from '@floating-ui/react'
import { useTranslatorContext } from '../context/TranslatorContext'
import { useLearningContext } from '../context/LearningContext'
import { useWorkspaceLayoutContext } from '../context/WorkspaceLayoutContext'
import { useUiLang } from '../hooks/useUiLang'
import { REFINEMENT_CHIPS } from '../lib/refinements'
import RefineRow from './RefineRow'
import Pill from './ui/Pill'

export default function AdjustMenu() {
  const { live, input, refinements, refineError, error, textareaRef } =
    useTranslatorContext()
  const hasError = Boolean(error)
  const learning = useLearningContext()
  const layout = useWorkspaceLayoutContext()
  const { t, lang } = useUiLang()
  const [open, setOpen] = useState(false)
  const [inline, setInline] = useState(false)
  const [iconOnly, setIconOnly] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const focusChips = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  // Every ordinary disclosure floats, including phone/split layouts. Only the
  // focused Custom editor needs the dedicated header when the keyboard is tight.
  const overlay = !inline && !(layout.keyboard && layout.tight)
  const { refs, floatingStyles } = useFloating({
    open: open && overlay,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(12),
      shift({ padding: 16 }),
      {
        name: 'primaryActionsClearance',
        fn: ({ x, y, rects }) => {
          const actions = menu.current
            ?.closest('.app-shell')
            ?.querySelector('.primary-result-actions')
            ?.getBoundingClientRect()
          if (
            !actions ||
            y >= actions.bottom ||
            y + rects.floating.height <= actions.top
          )
            return {}
          return {
            x: Math.max(
              16,
              Math.min(x, actions.left - rects.floating.width - 12),
            ),
          }
        },
      },
    ],
  })
  const compactOpen = open && !inline && layout.resultFirst
  const wasCompactOpen = useRef(false)
  useLayoutEffect(() => {
    if (compactOpen && !wasCompactOpen.current) learning?.setMinimized(true)
    wasCompactOpen.current = compactOpen
  }, [compactOpen, learning?.setMinimized])
  useLayoutEffect(() => {
    const root = menu.current
    const header = root?.closest<HTMLElement>('.app-header')
    const content = root?.querySelector<HTMLElement>('.adjust-content')
    if (!header || !content) return
    // Reserve space only for the dedicated tight-keyboard editor.
    const measure = () =>
      header.style.setProperty(
        '--adjust-panel-height',
        open && !inline && !overlay
          ? `${content.getBoundingClientRect().height + 6}px`
          : '0px',
      )
    let frame = 0
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(measure)
          })
    observer?.observe(content)
    measure()
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      header.style.removeProperty('--adjust-panel-height')
    }
  }, [open, inline, live?.intent, overlay])
  useLayoutEffect(() => {
    if (!input.trim()) setOpen(false)
  }, [input])
  useLayoutEffect(() => {
    const root = menu.current
    const controls = root?.querySelector<HTMLElement>('.refine-controls')
    if (!root || !controls) return
    const measure = () => {
      if (
        root.closest('.app-shell[data-short]') &&
        controls.querySelector('.refine-custom-editor:not([hidden])')
      )
        return
      const buttons = [
        ...controls.querySelectorAll<HTMLButtonElement>(':scope > button'),
      ]
      const gap = parseFloat(getComputedStyle(controls).columnGap) || 0
      const label = root.querySelector<HTMLElement>('.adjust-inline-label')
      const needed =
        buttons.reduce(
          (width, button) => width + button.getBoundingClientRect().width,
          0,
        ) +
        Math.max(0, buttons.length - 1) * gap +
        (label?.getBoundingClientRect().width || 0) +
        14
      const fits = needed > 0 && root.clientWidth >= needed + 2
      setIconOnly(root.clientWidth < 112)
      if (!fits && controls.contains(document.activeElement)) setOpen(true)
      if (fits && document.activeElement === trigger.current)
        focusChips.current = true
      setInline((wasInline) => (wasInline === fits ? wasInline : fits))
    }
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(root)
    observer?.observe(controls)
    measure()
    return () => observer?.disconnect()
  }, [lang, refinements, live?.intent, hasError])
  useLayoutEffect(() => {
    if (inline && focusChips.current) {
      menu.current
        ?.querySelector<HTMLButtonElement>('.refine-controls > button')
        ?.focus({ preventScroll: true })
      focusChips.current = false
    }
  }, [inline])
  useEffect(() => {
    if (!open || inline) return
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }
    // Touch browsers need not focus the trigger, so Escape must also work
    // outside the menu. Preserve normal click actions before dismissing.
    document.addEventListener('click', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('click', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open, inline])
  if (!live || live.intent !== 'sentence') return null
  const visible = open || inline
  const summary = refinements
    .map((instruction) => {
      const chip = REFINEMENT_CHIPS.find((c) => c.instruction === instruction)
      return chip
        ? t(chip.labelKey)
        : instruction.length > 20
          ? `${instruction.slice(0, 20)}…`
          : instruction
    })
    .join(' · ')
  return (
    <div
      className="adjust-menu"
      ref={menu}
      data-inline={inline || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open && !inline) {
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <Pill
        ref={(node) => {
          trigger.current = node
          refs.setReference(node)
        }}
        size="md"
        tone={summary || open ? 'active' : 'neutral'}
        data-active={summary ? true : undefined}
        aria-expanded={open}
        aria-controls={id}
        data-testid="adjust-button"
        className={`adjust-trigger ${iconOnly ? 'adjust-trigger-compact' : ''}`}
        aria-label={`${t('adjust')}${summary ? ` · ${summary}` : ''}`}
        title={
          iconOnly
            ? `${t('adjust')}${summary ? ` · ${summary}` : ''}`
            : undefined
        }
        style={inline ? { display: 'none' } : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {iconOnly && <SlidersHorizontal size={18} aria-hidden />}
        <span style={iconOnly ? { display: 'none' } : undefined}>
          {t('adjust')}
          {summary ? ` · ${summary}` : ''}
        </span>
        {!iconOnly && (
          <ChevronDown
            size={14}
            className={open ? 'rotate-180' : ''}
            aria-hidden
          />
        )}
      </Pill>
      <div
        id={id}
        ref={refs.setFloating}
        style={overlay ? floatingStyles : undefined}
        data-overlay={overlay || undefined}
        className="adjust-content"
        role="group"
        aria-label={t('adjust')}
        data-open={visible || undefined}
        aria-hidden={!visible || undefined}
        inert={!visible}
      >
        <span className="adjust-inline-label">{t('adjust')}</span>
        <RefineRow
          onCloseCustom={() => {
            if (!inline) setOpen(false)
            textareaRef.current?.focus({ preventScroll: true })
          }}
        />
      </div>
      {!visible && refineError && (
        <p className="adjust-error" role="alert">
          {t('refineFailed')}: {refineError.message}
        </p>
      )}
    </div>
  )
}
