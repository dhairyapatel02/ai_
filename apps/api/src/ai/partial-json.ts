/**
 * Incremental scanner over a streamed JSON object (structured output, ADR-0009). It reports
 *
 * - `onSection(key, index, value)` when a top-level property value is complete (index 0), or
 *   when an element of a top-level array is complete (index = element position);
 * - `onDelta(key, text)` with decoded string characters of the top-level property being written.
 *
 * It never throws on malformed input: incomplete or unparsable fragments are simply not reported
 * (the final document is validated as a whole afterwards).
 */
export interface SectionCallbacks {
  onSection: (key: string, index: number, value: unknown) => void;
  onDelta?: (key: string, text: string) => void;
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

export class PartialJsonSections {
  private text = '';
  private readonly stack: ('o' | 'a')[] = [];
  private readonly expectKey: boolean[] = [];
  private inString = false;
  private stringIsKey = false;
  private escape = false;
  private unicode: string | null = null;
  private keyBuf = '';
  private topKey: string | null = null;
  private topStart = -1;
  private topIsArray = false;
  private elemStart = -1;
  private elemIndex = 0;
  private pendingTopPrimitive = false;
  private pendingElemPrimitive = false;
  private delta = '';
  private deltaKey: string | null = null;

  constructor(private readonly cb: SectionCallbacks) {}

  push(chunk: string): void {
    for (const c of chunk) {
      const i = this.text.length;
      this.text += c;
      this.step(c, i);
    }
    this.flushDelta();
  }

  private step(c: string, i: number) {
    if (this.inString) {
      if (this.unicode !== null) {
        this.unicode += c;
        if (this.unicode.length === 4) {
          const code = Number.parseInt(this.unicode, 16);
          this.unicode = null;
          if (!Number.isNaN(code)) this.stringChar(String.fromCharCode(code));
        }
        return;
      }
      if (this.escape) {
        this.escape = false;
        if (c === 'u') this.unicode = '';
        else this.stringChar(ESCAPES[c] ?? c);
        return;
      }
      if (c === '\\') {
        this.escape = true;
        return;
      }
      if (c === '"') {
        this.inString = false;
        if (this.stringIsKey) {
          if (this.stack.length === 1) this.setTopKey(this.keyBuf);
        } else {
          this.valueEnd(i + 1, this.stack.length);
        }
        return;
      }
      this.stringChar(c);
      return;
    }

    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') return;
    const depth = this.stack.length;
    switch (c) {
      case '"': {
        const top = this.stack[depth - 1];
        this.stringIsKey = top === 'o' && this.expectKey[depth - 1] === true;
        if (this.stringIsKey) this.keyBuf = '';
        else this.valueStart(i, depth, false);
        this.inString = true;
        return;
      }
      case '{':
      case '[':
        this.valueStart(i, depth, false, c === '[');
        this.stack.push(c === '{' ? 'o' : 'a');
        this.expectKey.push(c === '{');
        return;
      case '}':
      case ']': {
        this.primitiveEnd(i, depth);
        this.stack.pop();
        this.expectKey.pop();
        this.valueEnd(i + 1, this.stack.length);
        return;
      }
      case ':':
        if (depth > 0) this.expectKey[depth - 1] = false;
        return;
      case ',':
        this.primitiveEnd(i, depth);
        if (this.stack[depth - 1] === 'o') this.expectKey[depth - 1] = true;
        return;
      default:
        // number / true / false / null
        if (depth === 1 && !this.pendingTopPrimitive && this.topStart < 0) {
          this.valueStart(i, depth, true);
        } else if (depth === 2 && this.topIsArray && !this.pendingElemPrimitive) {
          this.valueStart(i, depth, true);
        }
    }
  }

  private setTopKey(key: string) {
    this.flushDelta();
    this.topKey = key;
    this.topStart = -1;
    this.topIsArray = false;
    this.elemIndex = 0;
  }

  private stringChar(c: string) {
    if (this.stringIsKey) {
      this.keyBuf += c;
      return;
    }
    if (this.topKey === null || !this.cb.onDelta) return;
    if (this.deltaKey !== this.topKey) {
      this.flushDelta();
      this.deltaKey = this.topKey;
    }
    this.delta += c;
  }

  private flushDelta() {
    if (this.delta && this.deltaKey !== null) this.cb.onDelta?.(this.deltaKey, this.delta);
    this.delta = '';
  }

  private valueStart(i: number, depth: number, primitive: boolean, isArray = false) {
    if (depth === 1) {
      this.topStart = i;
      this.topIsArray = isArray;
      this.elemIndex = 0;
      this.pendingTopPrimitive = primitive;
    } else if (depth === 2 && this.topIsArray) {
      this.elemStart = i;
      this.pendingElemPrimitive = primitive;
    }
  }

  /** A string or container value ended at `end` (exclusive); `depth` = depth it lives at. */
  private valueEnd(end: number, depth: number) {
    if (depth === 1 && this.topStart >= 0 && !this.topIsArray) this.emitTop(end);
    else if (depth === 2 && this.topIsArray && this.elemStart >= 0) this.emitElem(end);
  }

  private primitiveEnd(end: number, depth: number) {
    if (depth === 1 && this.pendingTopPrimitive) {
      this.pendingTopPrimitive = false;
      this.emitTop(end);
    } else if (depth === 2 && this.pendingElemPrimitive) {
      this.pendingElemPrimitive = false;
      this.emitElem(end);
    }
  }

  private emitTop(end: number) {
    const value = this.parse(this.topStart, end);
    this.topStart = -1;
    if (this.topKey !== null && value !== undefined) {
      this.flushDelta();
      this.cb.onSection(this.topKey, 0, value);
    }
  }

  private emitElem(end: number) {
    const value = this.parse(this.elemStart, end);
    this.elemStart = -1;
    const index = this.elemIndex++;
    if (this.topKey !== null && value !== undefined) {
      this.flushDelta();
      this.cb.onSection(this.topKey, index, value);
    }
  }

  private parse(start: number, end: number): unknown {
    try {
      return JSON.parse(this.text.slice(start, end)) as unknown;
    } catch {
      return undefined;
    }
  }
}
