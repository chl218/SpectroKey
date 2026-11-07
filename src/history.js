// Pure ring-buffer bookkeeping for the live view's history: which slot each new
// column goes in, and which slices to copy to show a given scroll position.
// "Age" counts columns back from the newest (age 0). "Offset" is the age shown
// in the view's rightmost column: 0 = now, larger = further back in time.

export function createRing(capacity) {
  let count = 0; // columns kept, up to capacity
  let next = 0; // slot the next column goes in

  const ring = {
    get capacity() { return capacity; },
    get count() { return count; },

    // Claim the slot for a new column (overwrites the oldest when full).
    push() {
      const slot = next;
      next = (next + 1) % capacity;
      if (count < capacity) count++;
      return slot;
    },

    reset() { count = 0; next = 0; },

    // Slot holding the column `age` columns back, or -1 if it isn't kept.
    slotOf(age) {
      if (age < 0 || age >= count) return -1;
      return (((next - 1 - age) % capacity) + capacity) % capacity;
    },

    // Furthest back the view can scroll and still be full of history.
    maxOffset(width) { return Math.max(0, count - width); },

    clampOffset(offset, width) {
      return Math.min(Math.max(0, Math.round(offset)), ring.maxOffset(width));
    },

    /**
     * Copies that fill a `width`-column view whose rightmost column shows age
     * `offset`: [{ srcX, dstX, len }], oldest first. Columns older than the
     * history are left out (they stay blank on the left).
     */
    segments(offset, width) {
      const newestAge = offset;
      const oldestAge = Math.min(offset + width - 1, count - 1);
      if (oldestAge < newestAge) return [];
      const len = oldestAge - newestAge + 1;
      const srcX = ring.slotOf(oldestAge);
      const dstX = width - 1 - (oldestAge - offset);
      if (srcX + len <= capacity) return [{ srcX, dstX, len }];
      const first = capacity - srcX; // up to the end of the ring, then wrap to 0
      return [{ srcX, dstX, len: first }, { srcX: 0, dstX: dstX + first, len: len - first }];
    },
  };
  return ring;
}
