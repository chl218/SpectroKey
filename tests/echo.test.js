import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireEcho } from '../src/echo.js';

// Minimal stand-ins for an <input> and an output element.
function fakeInput(value = '') {
  const listeners = {};
  return {
    value,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    fire(type, event) { (listeners[type] ?? []).forEach((fn) => fn(event)); },
  };
}

test('echoes typed text into the output', () => {
  const input = fakeInput(); const output = { textContent: '' };
  wireEcho(input, output);
  input.value = 'hello'; input.fire('input');
  assert.equal(output.textContent, 'hello');
});

test('clearing the input clears the output', () => {
  const input = fakeInput(); const output = { textContent: '' };
  wireEcho(input, output);
  input.value = 'abc'; input.fire('input');
  input.value = ''; input.fire('input');
  assert.equal(output.textContent, '');
});

test('markup is echoed as plain text, not HTML', () => {
  const input = fakeInput(); const output = { textContent: '', innerHTML: '' };
  wireEcho(input, output);
  input.value = '<b>hi</b>'; input.fire('input');
  assert.equal(output.textContent, '<b>hi</b>');
  assert.equal(output.innerHTML, '');
});

test('shows any text already in the input when wired', () => {
  const input = fakeInput('preset'); const output = { textContent: '' };
  wireEcho(input, output);
  assert.equal(output.textContent, 'preset');
});

test('Enter clears the input but Output keeps the last line', () => {
  const input = fakeInput(); const output = { textContent: '' };
  wireEcho(input, output);
  input.value = 'last line'; input.fire('input');
  let prevented = false;
  input.fire('keydown', { key: 'Enter', isComposing: false, preventDefault() { prevented = true; } });
  assert.equal(input.value, '');
  assert.equal(output.textContent, 'last line');
  assert.equal(prevented, true);
});

test('other keys do not clear the input', () => {
  const input = fakeInput(); const output = { textContent: '' };
  wireEcho(input, output);
  input.value = 'abc'; input.fire('input');
  input.fire('keydown', { key: 'a', isComposing: false, preventDefault() {} });
  assert.equal(input.value, 'abc');
});

test('Enter while composing (IME) does not clear', () => {
  const input = fakeInput(); const output = { textContent: '' };
  wireEcho(input, output);
  input.value = 'にほ'; input.fire('input');
  input.fire('keydown', { key: 'Enter', isComposing: true, preventDefault() {} });
  assert.equal(input.value, 'にほ');
});
