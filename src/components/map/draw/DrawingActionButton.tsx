import { useRef, type ButtonHTMLAttributes } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> { onAction: () => void; title: string }

/** Map drag gestures can suppress the following compatibility click on touch devices. */
export function DrawingActionButton({ onAction, children, title, ...props }: Props) {
  const touchRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const activatedAtRef = useRef(0);
  return <button type="button" {...props} title={title}
    onPointerDown={event => {
      if (event.pointerType === 'touch' && event.isPrimary) touchRef.current = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
      };
    }}
    onPointerCancel={() => { touchRef.current = null; }}
    onPointerUp={event => {
      const touch = touchRef.current;
      touchRef.current = null;
      if (!touch || touch.id !== event.pointerId || props.disabled ||
        Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) return;
      event.preventDefault();
      activatedAtRef.current = Date.now();
      onAction();
    }}
    onClick={event => {
      // Keep keyboard and assistive-technology clicks; consume a touch tap only once.
      if (event.detail > 0 && Date.now() - activatedAtRef.current < 700) return;
      onAction();
    }}
  >{children}</button>;
}
