/** P pauses play; Escape remains the browser's fullscreen shortcut. */
export function shouldTogglePause(event) {
  const target = event.target;
  return typeof event.key === 'string' && event.key.toLowerCase() === 'p' &&
    !event.repeat && !event.defaultPrevented && !event.isComposing &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    !target?.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) &&
    !target?.closest?.('[contenteditable=""], [contenteditable="true"], [role="textbox"]');
}
