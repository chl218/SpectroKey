// Echo box: shows whatever is typed in the input, as plain text.

/**
 * Mirror `inputEl.value` into `outputEl` on every edit.
 * Enter clears the input and leaves the output showing the last line.
 * Uses textContent (never innerHTML), so typed markup is shown literally.
 */
export function wireEcho(inputEl, outputEl) {
  const update = () => { outputEl.textContent = inputEl.value; };
  inputEl.addEventListener('input', update);
  inputEl.addEventListener('keydown', (event) => {
    // Skip Enter while an IME is composing (it confirms the composition there).
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    inputEl.value = '';
  });
  update();
}
