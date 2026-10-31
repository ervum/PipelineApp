export function isModKey(
  event: KeyboardEvent | MouseEvent | { ctrlKey: boolean; metaKey: boolean },
): boolean {
  return event.ctrlKey || event.metaKey;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}
