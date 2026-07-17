import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { tagColor } from "../../lib/constants";

/** Free-text tag editor: colored chips with remove, input adds on Enter/comma. */
export function TagInput({
  tags,
  onChange,
  placeholder,
  className,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const tag = draft.trim().replace(/,+$/, "");
    setDraft("");
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
  };

  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1",
        className,
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
            tagColor(tag),
          )}
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="opacity-60 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          if (e.target.value.endsWith(",")) {
            setDraft(e.target.value);
            // commit on comma
            const tag = e.target.value.slice(0, -1).trim();
            setDraft("");
            if (tag && !tags.includes(tag)) onChange([...tags, tag]);
          } else {
            setDraft(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="min-w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
