import { useEffect, useState } from "react";
import { TextFilter } from "./ui";

/** Input teks yang baru menerapkan nilai saat Enter/blur, supaya tidak fetch per ketikan. */
export function DraftTextFilter({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      onBlur={commit}
    >
      <TextFilter label={label} value={draft} onChange={setDraft} placeholder={placeholder} />
    </div>
  );
}
