// Monaco-based editor pane for the curated file editor.
// Ported from ai-wb-gui's EditorView; language is passed explicitly
// (the caller knows each file's role) and validation markers come in
// via props instead of a language service.

import { useEffect, useRef } from "react";
import monaco from "../../monaco";
import { invokeCmd } from "../../lib/tauri";
import type { EditorLanguage, YamlError } from "../../types";

interface EditorViewProps {
  path: string;
  initialContent: string;
  language: EditorLanguage;
  extraRoots: string[];
  onDirtyChange: (dirty: boolean) => void;
  onContentChange: (content: string) => void;
  onSaved: () => void;
  onSaveError: (error: string) => void;
  /** Parent stores the save callback here to trigger it from the toolbar. */
  saveRef: React.MutableRefObject<(() => void) | null>;
  yamlError: YamlError | null;
}

export function EditorView({
  path,
  initialContent,
  language,
  extraRoots,
  onDirtyChange,
  onContentChange,
  onSaved,
  onSaveError,
  saveRef,
  yamlError,
}: EditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let savedContent = initialContent;
    const editor = monaco.editor.create(container, {
      value: initialContent,
      language,
      theme: "vs",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      fontSize: 13,
    });
    editorRef.current = editor;

    const save = () => {
      const content = editor.getValue();
      invokeCmd<void>("fs_write_file", {
        path,
        content,
        allowCreate: false,
        extraRoots,
      })
        .then(() => {
          savedContent = content;
          onDirtyChange(false);
          onSaved();
        })
        .catch((err) => onSaveError(String(err)));
    };

    saveRef.current = save;
    const changeDisposable = editor.onDidChangeModelContent(() => {
      const content = editor.getValue();
      onDirtyChange(content !== savedContent);
      onContentChange(content);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    editor.focus();

    return () => {
      saveRef.current = null;
      editorRef.current = null;
      changeDisposable.dispose();
      editor.dispose();
    };
    // Recreate the editor only when a different file is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Apply syntax-validation markers from the backend.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const markers: monaco.editor.IMarkerData[] = yamlError
      ? [
          {
            severity: monaco.MarkerSeverity.Error,
            message: yamlError.message,
            startLineNumber: yamlError.line ?? 1,
            startColumn: yamlError.column ?? 1,
            endLineNumber: yamlError.line ?? 1,
            endColumn: (yamlError.column ?? 1) + 1,
          },
        ]
      : [];
    monaco.editor.setModelMarkers(model, "odoodev-yaml", markers);
  }, [yamlError]);

  return <div ref={containerRef} className="h-full w-full" />;
}
