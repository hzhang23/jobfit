import type { ProvenanceLine } from '../api';

/**
 * The product-layer response to failure mode 1, on screen.
 *
 * Markers render in the same pass as the text. They are never fetched
 * separately or faded in, because a reader who sees the unmarked version
 * first has already been misled.
 */
export function ProvenanceText({ lines }: { lines: ProvenanceLine[] }) {
  return (
    <div>
      {lines.map((l, i) => (
        <div key={i} className={`resume-line ${l.status}`}>
          {l.line || ' '}
          {l.status === 'unverified' && (
            <span className="flag">not in your master resume: {l.unsupported.join(', ')}</span>
          )}
        </div>
      ))}
    </div>
  );
}
