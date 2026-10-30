// Hovering a text field shows its full content as a tooltip: the value, or the placeholder
// when empty. Narrow fields (e.g. in the rule grid) cut both off with "…".
const TEXT_TYPES = new Set(['', 'text', 'search', 'number', 'email', 'url']);

function isTextField(
  el: EventTarget | null,
): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type);
}

export function installFieldTooltips(doc: Document = document): () => void {
  const onOver = (e: Event) => {
    const el = e.target;
    if (!isTextField(el)) return;
    // Fields with their own tooltip keep it.
    if (el.title && el.dataset.autoTitle !== '1') return;
    const text = (el.value || el.placeholder || '').trim();
    el.title = text;
    el.dataset.autoTitle = '1';
  };
  doc.addEventListener('mouseover', onOver, true);
  return () => doc.removeEventListener('mouseover', onOver, true);
}
