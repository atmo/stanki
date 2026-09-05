import { useLayoutEffect, useRef, type ComponentProps } from 'react';

/**
 * A textarea that grows to its content. Fixed `rows` meant a two-line box for a
 * back or an explanation that is routinely longer, so editing anything real
 * happened through a slot showing a fraction of it.
 *
 * Sized in a layout effect rather than with CSS `field-sizing: content`, which
 * Safari still does not support — and this is used on a phone more than anywhere
 * else. Keyed on the value so it also fits text that arrives programmatically,
 * not just typing: switching cards in the editor replaces the value without any
 * input event.
 */
export function AutoTextarea({ value, ...rest }: ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first, or scrollHeight only ever reports the taller of the two
    // and the box can grow but never shrink.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return <textarea ref={ref} value={value} {...rest} />;
}
