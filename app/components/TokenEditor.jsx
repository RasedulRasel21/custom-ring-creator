/* eslint-disable react/prop-types -- the repo lints for prop-types but does not
   depend on the `prop-types` package, and adding a runtime dependency purely to
   satisfy lint is not worth it. Props are documented in the JSDoc below. */
import { useRef, useState } from "react";

/**
 * An editable, reorderable list of short labels — ring sizes, diamond origins.
 *
 * The controls stay hidden until a token is hovered or focused, because showing
 * reorder arrows and a delete on all 19 sizes at once turns the row into noise.
 * Drag is the primary way to reorder; the arrows are the keyboard-reachable
 * equivalent and are why they exist at all.
 *
 * The parent owns the data. This component only reports intent.
 */
export default function TokenEditor({
  items,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  placeholder = "Add…",
  addLabel = "Add",
  renamable = true,
  disabled = false,
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const dragged = useRef(null);

  function commitAdd() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  }

  function commitRename(id, value) {
    const v = value.trim();
    setEditingId(null);
    if (v) onRename(id, v);
  }

  function handleDrop(targetId) {
    const from = dragged.current;
    setDragId(null);
    setOverId(null);
    dragged.current = null;
    if (from && targetId && from !== targetId) onReorder(from, targetId);
  }

  return (
    <div className={"tk" + (disabled ? " is-disabled" : "")}>
      <div className="tk-well">
        {items.map((item, i) => (
          <span
            key={item.id}
            className={
              "tk-item" +
              (dragId === item.id ? " is-dragging" : "") +
              (overId === item.id ? " is-over" : "")
            }
            draggable={editingId !== item.id}
            onDragStart={() => { dragged.current = item.id; setDragId(item.id); }}
            onDragEnd={() => { setDragId(null); setOverId(null); dragged.current = null; }}
            onDragOver={(e) => { e.preventDefault(); setOverId(item.id); }}
            onDragLeave={() => setOverId((cur) => (cur === item.id ? null : cur))}
            onDrop={(e) => { e.preventDefault(); handleDrop(item.id); }}
          >
            {editingId === item.id ? (
              <input
                className="tk-edit"
                /* Focused on mount rather than with autoFocus, which lint flags.
                   Uncontrolled, so typing never re-renders and moves the caret. */
                ref={(el) => el && (el.focus(), el.select())}
                defaultValue={item.label}
                onBlur={(e) => commitRename(item.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(item.id, e.target.value);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="tk-label"
                title={renamable ? "Click to rename · drag to reorder" : item.label}
                onClick={() => renamable && setEditingId(item.id)}
              >
                {item.label}
              </button>
            )}

            <span className="tk-tools">
              <button type="button" className="tk-mv" disabled={i === 0}
                onClick={() => onReorder(item.id, items[i - 1]?.id)}
                aria-label={`Move ${item.label} earlier`}>‹</button>
              <button type="button" className="tk-mv" disabled={i === items.length - 1}
                onClick={() => onReorder(item.id, items[i + 1]?.id)}
                aria-label={`Move ${item.label} later`}>›</button>
              <button type="button" className="tk-x" onClick={() => onDelete(item.id)}
                aria-label={`Remove ${item.label}`}>×</button>
            </span>
          </span>
        ))}

        <span className="tk-add">
          <input
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
            }}
          />
          <button type="button" className="tk-addbtn" onClick={commitAdd} disabled={!draft.trim()}>
            {addLabel}
          </button>
        </span>
      </div>
    </div>
  );
}
