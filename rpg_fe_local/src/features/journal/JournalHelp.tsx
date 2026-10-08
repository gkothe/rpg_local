import { useEffect, useId, useRef } from 'react';
import { type JournalSection } from './journalSections';

export default function JournalHelp({
  section,
  onClose,
}: {
  section: JournalSection;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="journal-help-dialog"
      aria-labelledby={headingId}
      onClose={() => {
        // Strict Mode can reopen the dialog before a cleanup close event is delivered.
        if (!dialog.current?.open) onClose();
      }}
    >
      <div className="stack">
        <h2 id={headingId} tabIndex={-1} autoFocus>
          {section.label} help
        </h2>
        <section>
          <h3>What this section contains</h3>
          <p>{section.information}</p>
        </section>
        <section>
          <h3>How it affects the GM</h3>
          <p>{section.gmEffect}</p>
        </section>
        {'usage' in section && (
          <section>
            <h3>How to use it</h3>
            <p>{section.usage}</p>
          </section>
        )}
        <button type="button" onClick={() => dialog.current?.close()}>
          Close help
        </button>
      </div>
    </dialog>
  );
}
