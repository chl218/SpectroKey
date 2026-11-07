// Echo box: shows whatever is typed in the input, as plain text.

/**
 * Mirror `inputEl.value` into `outputEl` on every edit.
 * Uses textContent (never innerHTML), so typed markup is shown literally.
 */
export function wireEcho(inputEl, outputEl) {
  const update = () => { outputEl.textContent = inputEl.value; };
  inputEl.addEventListener('input', update);
  update();
}
