export type PointerPoint = { x: number; y: number; time: number }
export function isInspectTap(
  start: PointerPoint,
  end: PointerPoint,
  selection: string,
) {
  return (
    end.time - start.time < 350 &&
    Math.hypot(end.x - start.x, end.y - start.y) < 8 &&
    !selection
  )
}

export function textOffsetAtPoint(
  root: HTMLElement,
  x: number,
  y: number,
): number | null {
  const doc = root.ownerDocument as unknown as {
    createRange: Document['createRange']
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caret = doc.caretPositionFromPoint?.(x, y)
  const fallback = !caret ? doc.caretRangeFromPoint?.(x, y) : null
  const node = caret?.offsetNode ?? fallback?.startContainer
  const offset = caret?.offset ?? fallback?.startOffset
  if (!node || offset === undefined || !root.contains(node)) return null
  const range = doc.createRange()
  range.setStart(root, 0)
  range.setEnd(node, offset)
  return range.toString().length
}
