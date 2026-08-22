/**
 * frankie-spec-key.js — case-folding rule for Frankie's session spec snapshot.
 *
 * block-frankie-writes.js decides "is this a GRADUATED spec?" by looking an
 * absolute path up in a Set snapshotted at session start. On a case-sensitive
 * filesystem an exact-string lookup is exactly right. On a case-INSENSITIVE
 * volume (macOS APFS/HFS+, Windows NTFS) it is strictly weaker than the
 * existsSync fallback it refines: specs/Checkout.flow.yaml is snapshotted, a
 * write to specs/checkout.flow.yaml misses the Set, classifies as a NEW spec,
 * and lands on the graduated file anyway — the same inode, under a different
 * spelling.
 *
 * The fix is to fold keys on those platforms, at snapshot-WRITE time and at
 * lookup time alike. Keeping the rule a pure function of the platform (never
 * of anything stored in the snapshot payload) means a snapshot written by one
 * hook process is read consistently by the next one, and re-folding an
 * already-folded key is a no-op.
 *
 * Folding only ever makes MORE paths resolve to the same graduated entry, so
 * it can only ever block more — the fail-closed direction.
 */

/** True on platforms whose default filesystem is case-insensitive. */
export function isCaseInsensitiveFs(platform = process.platform) {
  return platform === 'darwin' || platform === 'win32';
}

/**
 * Snapshot key for an absolute path: lower-cased on case-insensitive
 * platforms, returned unchanged everywhere else. Idempotent.
 */
export function foldSpecKey(absPath, platform = process.platform) {
  return isCaseInsensitiveFs(platform) ? absPath.toLowerCase() : absPath;
}
