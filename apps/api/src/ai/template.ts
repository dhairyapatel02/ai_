/**
 * Safe prompt templating and untrusted-data handling (AI-05, SEC-11, ADR-0009).
 *
 * - `fillTemplate` substitutes `{{name}}` placeholders with a replacer *function*, so `$&`, `$'`,
 *   `` $` `` and `$1` in values are inserted literally (String.replace pattern expansion bug).
 *   Unknown placeholders throw: a prompt never ships with a hole.
 * - `cleanText` strips control/bidi characters and caps length (per-field caps).
 * - `dataBlock` serialises untrusted activity data as JSON inside `<tag>` delimiters; the closing
 *   delimiter can never appear inside (`<` is <-escaped by `safeJson`).
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`Template placeholder {{${name}}} has no value`);
    }
    return String(values[name]);
  });
}

// C0/C1 controls except \t \n, plus zero-width and bidi overrides (Trojan-source style tricks).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

export function cleanText(value: string | null | undefined, max: number): string {
  if (!value) return '';
  const cleaned = value.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** JSON with `<`, `>` and `&` escaped so no tag-like sequence survives inside a data block. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 1)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function dataBlock(tag: string, value: unknown): string {
  if (!/^[a-z_]+$/.test(tag)) throw new Error('invalid data block tag');
  return `<${tag}>\n${safeJson(value)}\n</${tag}>`;
}

/** Caps from ADR-0009 (characters). */
export const TEXT_CAPS = {
  title: 300,
  body: 2000,
  userText: 8000,
  ladder: 12000,
} as const;
