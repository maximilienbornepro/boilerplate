/**
 * UX PREVIEW SANDBOX — current snippet being previewed.
 *
 * DO NOT MODIFY BY HAND. This file is automatically rewritten by Claude
 * (ux-ui-guard skill) before a user validates a UI change visually.
 *
 * Shape contract :
 *   - Default export must be a React component rendering the snippet.
 *   - Can import from `@boilerplate/shared/components` and any types from
 *     the target module.
 *   - Keep it SELF-CONTAINED : no side effects, no fetches, no router
 *     dependencies. If the real component needs data, mock it inline.
 *
 * After a user confirms (says « oui ») and the real edit is written,
 * this file is reset to the placeholder below via the same skill flow.
 */
export default function CurrentPreview() {
  return (
    <div
      style={{
        padding: '32px',
        border: '1px dashed var(--border-color)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--font-size-sm)',
        textAlign: 'center',
      }}
    >
      Aucune preview en cours.
      <br />
      <br />
      <small>
        Le prochain changement UX/UI déclenchera le skill <code>ux-ui-guard</code> qui
        écrira ici le snippet à valider visuellement.
      </small>
    </div>
  );
}
