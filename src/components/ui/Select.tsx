import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  useTypeahead,
} from '@floating-ui/react'
import { Check, ChevronDown } from 'lucide-react'
import Pill from './Pill'
import { floatingPanelBoundary } from '../../lib/floatingPanelBoundary'

type Tone = 'neutral' | 'accent' | 'warm' | 'active'

export type SelectOption<TValue extends string> = {
  value: TValue
  label: ReactNode
  /** String used for keyboard typeahead matching. Defaults to `label` if it's a string, else `value`. */
  searchLabel?: string
}

type Props<TValue extends string> = {
  value: TValue
  onChange: (next: TValue) => void
  options: ReadonlyArray<SelectOption<TValue>>
  tone?: Tone
  size?: 'sm' | 'md'
  /** Trigger content when `value` is not among `options` (chip-bar "more" trigger). */
  placeholder?: ReactNode
  showChevron?: boolean
  'aria-label'?: string
  'data-testid'?: string
}

export default function Select<TValue extends string>({
  value,
  onChange,
  options,
  tone = 'neutral',
  size: pillSize = 'sm',
  placeholder,
  showChevron = true,
  'aria-label': ariaLabel,
  'data-testid': testId = 'select-trigger',
}: Props<TValue>) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const listRef = useRef<Array<HTMLElement | null>>([])
  const listContentRef = useRef<string[]>([])
  // Reassigned every render (not just once) so keyboard typeahead always
  // matches the current option set — the chip-bar's "more" menu options
  // shrink when a recent chip gets promoted, and a stale ref would let
  // typeahead select the wrong language.
  listContentRef.current = options.map(
    (o) => o.searchLabel ?? (typeof o.label === 'string' ? o.label : o.value),
  )

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset({ mainAxis: 6 }),
      flip(floatingPanelBoundary),
      shift(floatingPanelBoundary),
      size((state) => ({
        ...floatingPanelBoundary(state),
        apply({ availableHeight, elements, rects }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, Math.min(availableHeight, 320))}px`,
            minWidth: `${rects.reference.width}px`,
          })
        },
      })),
    ],
  })

  const click = useClick(context, { event: 'mousedown' })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'listbox' })
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : null,
    onNavigate: setActiveIndex,
    loop: true,
  })
  const typeahead = useTypeahead(context, {
    listRef: listContentRef,
    activeIndex,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : null,
    onMatch: open ? setActiveIndex : undefined,
  })

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [click, dismiss, role, listNav, typeahead],
  )

  function handleSelect(i: number) {
    const opt = options[i]
    if (!opt) return
    onChange(opt.value)
    setOpen(false)
  }

  return (
    <>
      <Pill
        ref={refs.setReference}
        tone={tone}
        size={pillSize}
        aria-label={ariaLabel}
        aria-expanded={open}
        data-testid={testId}
        {...getReferenceProps()}
      >
        <span>{selected?.label ?? placeholder ?? value}</span>
        {showChevron && (
          <ChevronDown
            size={12}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </Pill>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <ul
              ref={refs.setFloating}
              style={{
                ...floatingStyles,
                visibility: isPositioned ? 'visible' : 'hidden',
              }}
              {...getFloatingProps()}
              className="z-50 overflow-auto rounded-lg border border-border bg-panel py-1 text-sm text-ink shadow-lg scrollbar-thin focus:outline-none"
            >
              {options.map((opt, i) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === selectedIndex}
                    ref={(node) => {
                      listRef.current[i] = node
                    }}
                    tabIndex={i === activeIndex ? 0 : -1}
                    data-testid="select-option"
                    data-value={opt.value}
                    {...getItemProps({
                      onClick: () => handleSelect(i),
                      onKeyDown: (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelect(i)
                        }
                      },
                    })}
                    className={`flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-1.5 text-left transition hover:bg-panel-2 focus:bg-panel-2 focus:outline-none ${
                      i === activeIndex ? 'bg-panel-2' : ''
                    } ${i === selectedIndex ? 'text-accent' : 'text-ink'}`}
                  >
                    <span>{opt.label}</span>
                    {i === selectedIndex && (
                      <Check size={14} className="text-accent" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}
