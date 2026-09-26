import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/** Drag-to-reorder list (HTML5 DnD), plus keyboard move buttons for accessibility. */
export function ReorderList<T>(props: { items: T[]; keyOf: (t: T) => string | number; onReorder: (items: T[]) => void; render: (t: T, i: number, move: (d: -1 | 1) => void) => ComponentChildren }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= props.items.length || from === to) return;
    const next = props.items.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    props.onReorder(next);
  };
  return (
    <div class="list">
      {props.items.map((t, i) => (
        <div
          key={props.keyOf(t)}
          class={`list-item ${drag === i ? 'dragging' : ''} ${over === i && drag !== i ? 'over' : ''}`}
          draggable
          onDragStart={(e) => (setDrag(i), e.dataTransfer?.setData('text/plain', String(i)))}
          onDragOver={(e) => (e.preventDefault(), setOver(i))}
          onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => (e.preventDefault(), drag != null && move(drag, i), setDrag(null), setOver(null))}
          onDragEnd={() => (setDrag(null), setOver(null))}
        >
          {props.render(t, i, (d) => move(i, i + d))}
        </div>
      ))}
    </div>
  );
}

export function MoveButtons({ move, i, n }: { move: (d: -1 | 1) => void; i: number; n: number }) {
  return (
    <span style="display:inline-flex;flex-direction:column">
      <button class="icon-btn" style="padding:0 4px;font-size:10px" aria-label="Move up" disabled={i === 0} onClick={() => move(-1)}>▲</button>
      <button class="icon-btn" style="padding:0 4px;font-size:10px" aria-label="Move down" disabled={i === n - 1} onClick={() => move(1)}>▼</button>
    </span>
  );
}
