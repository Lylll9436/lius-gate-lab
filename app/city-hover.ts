export type PointerState = {
  x: number;
  y: number;
  active: boolean;
  blocked: boolean;
  dragging: boolean;
  /** The building or place under the pointer after the last hover pass. */
  id: string | null;
};
export function hoverPointer(): PointerState {
  return { x: 0, y: 0, active: false, blocked: false, dragging: false, id: null };
}
export function pointerMove(
  state: PointerState,
  e: { clientX: number; clientY: number; pointerType: string; buttons: number },
) {
  state.x = e.clientX;
  state.y = e.clientY;
  state.active =
    e.pointerType === 'mouse' && e.buttons === 0 && !state.dragging;
  state.blocked = false;
}
export function clearPointer(state: PointerState) {
  state.active = false;
  state.blocked = true;
  state.id = null;
}
export function hoverAllowed(
  state: PointerState,
  inspect: boolean,
  viewport: boolean,
) {
  return (
    state.active && !state.blocked && !state.dragging && !inspect && viewport
  );
}
/** A box on screen, px from the stage's top left. */
export type ScreenBox = { left: number; top: number; right: number; bottom: number };
/**
 * Where the floating label goes (its top left, px in the stage): up and right of the pointer, to its
 * left at the view's right edge and below it at the top, `pad` inside the view. Given the place it
 * names as a box on screen (`subject`: City mode), a label that would cover it moves beside it
 * instead, `beside` clear, the first way it fits in the view: right of it, below it, left of it, then
 * above it, each in line with where the pointer put it. Only a place with no room beside it (one
 * filling the view) keeps the pointer's place. In City mode's overview the label (and the caption's
 * chip, now hidden there) covered half of the sky island's villa.
 */
export function labelPosition(
  pointer: { x: number; y: number },
  label: { width: number; height: number },
  view: { width: number; height: number },
  subject?: ScreenBox,
) {
  const gap = 18,
    pad = 10,
    beside = 12;
  let x = pointer.x + gap,
    y = pointer.y - label.height - gap;
  if (x + label.width > view.width - pad) x = pointer.x - label.width - gap;
  if (y < pad) y = pointer.y + gap;
  const at = {
    x: Math.max(
      pad,
      Math.min(x, Math.max(pad, view.width - label.width - pad)),
    ),
    y: Math.max(
      pad,
      Math.min(y, Math.max(pad, view.height - label.height - pad)),
    ),
  };
  if (
    !subject ||
    at.x >= subject.right ||
    at.x + label.width <= subject.left ||
    at.y >= subject.bottom ||
    at.y + label.height <= subject.top
  )
    return at;
  const fits = (p: { x: number; y: number }) =>
    p.x >= pad &&
    p.y >= pad &&
    p.x + label.width <= view.width - pad &&
    p.y + label.height <= view.height - pad;
  return (
    [
      { x: subject.right + beside, y: at.y },
      { x: at.x, y: subject.bottom + beside },
      { x: subject.left - beside - label.width, y: at.y },
      { x: at.x, y: subject.top - beside - label.height },
    ].find(fits) ?? at
  );
}
