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
export function labelPosition(
  pointer: { x: number; y: number },
  label: { width: number; height: number },
  view: { width: number; height: number },
) {
  const gap = 18,
    pad = 10;
  let x = pointer.x + gap,
    y = pointer.y - label.height - gap;
  if (x + label.width > view.width - pad) x = pointer.x - label.width - gap;
  if (y < pad) y = pointer.y + gap;
  return {
    x: Math.max(
      pad,
      Math.min(x, Math.max(pad, view.width - label.width - pad)),
    ),
    y: Math.max(
      pad,
      Math.min(y, Math.max(pad, view.height - label.height - pad)),
    ),
  };
}
