/**
 * Only same-site relative paths (no open redirect): must start with a single `/`, and contain no
 * backslashes or control characters (browsers strip tabs/newlines, turning `/\t/evil` into `//evil`).
 */
export function safeCallback(value: string | undefined): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return '/';
  return value;
}
