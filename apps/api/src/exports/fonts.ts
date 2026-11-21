import { nativeRequire } from '../common/native-require';

/**
 * Fonts embedded in exported PDFs (ADR-0012): Instrument Sans + JetBrains Mono from the
 * `@fontsource/*` packages (OFL-1.1, installed as API dependencies, so they ship in the Docker
 * image). Files are read from disk — never fetched at render time. Latin + Latin Extended subsets.
 */
const requireNative = nativeRequire(__filename);

const file = (pkg: string, name: string) => requireNative.resolve(`${pkg}/files/${name}.woff`);

export const PDF_FONT = {
  sans: 'Instrument Sans',
  sansExt: 'Instrument Sans Ext',
  mono: 'JetBrains Mono',
};

export function fontSources() {
  const sans = (subset: 'latin' | 'latin-ext', weight: number) =>
    file('@fontsource/instrument-sans', `instrument-sans-${subset}-${weight}-normal`);
  return [
    {
      family: PDF_FONT.sans,
      fonts: [400, 500, 600].map((w) => ({ src: sans('latin', w), fontWeight: w })),
    },
    {
      family: PDF_FONT.sansExt,
      fonts: [400, 500, 600].map((w) => ({ src: sans('latin-ext', w), fontWeight: w })),
    },
    {
      family: PDF_FONT.mono,
      fonts: [
        {
          src: file('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal'),
          fontWeight: 400,
        },
      ],
    },
  ];
}
