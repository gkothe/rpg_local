import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import architecture from '../../../docs/documentation/rpg-backend-architecture.md?raw';
import { edges, nodes, steps, tools, storageItems } from '../features/flow/content';
import FlowDiagram from '../features/flow/FlowDiagram';
import FlowInspector from '../features/flow/FlowInspector';
import TurnWalkthrough from '../features/flow/TurnWalkthrough';
import PayloadExplorer from '../features/flow/PayloadExplorer';
import ToolExplorer from '../features/flow/ToolExplorer';
import StorageExplorer from '../features/flow/StorageExplorer';
import type { FlowView } from '../features/flow/types';
import '../features/flow/flow.css';

const sections = Array.from(
  architecture.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.?(?: )(.+)$/gm),
  (match) => ({ id: match[1], label: `${match[1]} ${match[2]}`, offset: match.index })
);
export default function Flow() {
  const [query, setQuery] = useSearchParams();
  const [documentOpen, setDocumentOpen] = useState(false);
  const [section, setSection] = useState('1');
  const documentRef = useRef<HTMLDetailsElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
  const step = steps.find((s) => s.id === query.get('step')) ?? steps[0];
  const selected =
    [...nodes, ...edges].find((n) => n.id === query.get('node')) ??
    nodes.find((n) => n.id === step.node)!;
  const requestedView = query.get('view');
  const view: FlowView =
    requestedView === 'payload' || requestedView === 'tools' || requestedView === 'storage'
      ? requestedView
      : 'journey';
  const tool = tools.find((t) => t.id === query.get('node')) ?? tools[0];
  const storage = storageItems.find((t) => t.id === query.get('node')) ?? storageItems[0];
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(values)) next.set(key, value);
    setQuery(next);
  }
  function showSection(id: string) {
    setSection(id);
    setDocumentOpen(true);
    requestAnimationFrame(() => {
      documentRef.current?.scrollIntoView?.({ block: 'start' });
      documentRef.current?.querySelector('select')?.focus();
    });
  }
  const sectionIndex = Math.max(
    0,
    sections.findIndex((s) => s.id === section)
  );
  function selectItem(id: string) {
    update({ node: id });
    if (window.matchMedia?.('(max-width: 900px)').matches)
      requestAnimationFrame(() => {
        inspectorRef.current?.scrollIntoView({ block: 'start' });
        inspectorRef.current?.querySelector('h2')?.focus({ preventScroll: true });
      });
  }
  function returnToExplorer() {
    explorerRef.current?.scrollIntoView({ block: 'start' });
    explorerRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }
  const sectionText = architecture.slice(
    sections[sectionIndex]?.offset ?? 0,
    sections[sectionIndex + 1]?.offset ?? architecture.length
  );
  return (
    <div className="page flow-page">
      <div className="flow-kicker">How the system works Â· reviewed 04 Oct 2026</div>
      <h1>Follow the Flow</h1>
      <p className="flow-lead">
        Follow your action through the app and the language model (LLM). See what each part
        receives, how tools help, and how the app checks the response before saving it to the
        database.
      </p>
      <p className="flow-notice">
        Educational example. This page makes no AI calls and does not change your campaign. The
        names, values, and steps below are made up for the guide.
      </p>
      <nav className="flow-tabs" aria-label="Flow views">
        {(
          [
            ['journey', 'Journey', 'Follow an action'],
            ['payload', 'Payload', 'What the LLM receives'],
            ['tools', 'Tools', 'How tools are used'],
            ['storage', 'Storage', 'What gets saved'],
          ] as const
        ).map(([id, label, hint]) => (
          <Link key={id} to={`/flow?view=${id}`} aria-current={view === id ? 'page' : undefined}>
            {label} <small>{hint}</small>
          </Link>
        ))}
      </nav>
      <div className="flow-layout">
        <div ref={explorerRef}>
          {view === 'storage' ? (
            <StorageExplorer selected={storage.id} onSelect={selectItem} />
          ) : view === 'tools' ? (
            <ToolExplorer selected={tool.id} onSelect={selectItem} />
          ) : view === 'payload' ? (
            <PayloadExplorer />
          ) : (
            <>
              <FlowDiagram selected={selected.id} onSelect={selectItem} />
              <div style={{ marginTop: '1.3rem' }}>
                <TurnWalkthrough
                  step={step.id}
                  onStep={(id) => update({ step: id, node: steps.find((s) => s.id === id)!.node })}
                />
              </div>
            </>
          )}
        </div>
        <FlowInspector
          ref={inspectorRef}
          onReturn={returnToExplorer}
          item={
            view === 'storage'
              ? storage
              : view === 'tools'
                ? tool
                : view === 'payload'
                  ? nodes[3]
                  : selected
          }
          onSection={showSection}
        />
      </div>
      <details
        ref={documentRef}
        className="flow-card flow-doc"
        open={documentOpen}
        onToggle={(e) => setDocumentOpen(e.currentTarget.open)}
      >
        <summary>Read the architecture document</summary>
        <p>
          This is the architecture document the guide is based on, shown as plain text. Section 6
          describes this page. If the document and the backend code differ, the code determines how
          the system runs.
        </p>
        <label>
          Document section
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <pre aria-label="Architecture document">{sectionText}</pre>
      </details>
    </div>
  );
}
