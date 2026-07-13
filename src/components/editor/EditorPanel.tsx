import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { logError, reportError } from "../../lib/errors";
import { toastSuccess, toastError } from "../../store/toastStore";
import { FileListSidebar } from "./FileListSidebar";
import { EditorView } from "./EditorView";
import { NewPlaybookDialog, PLAYBOOK_TEMPLATE } from "./NewPlaybookDialog";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import { ValidationPanel } from "./ValidationPanel";
import { Button } from "../ui/button";
import { FlaskConical, Loader2, Save } from "lucide-react";
import type {
  CuratedFiles,
  EditorLanguage,
  FileContent,
  SemanticValidation,
  YamlError,
} from "../../types";

function languageFor(path: string): EditorLanguage {
  const name = path.split("/").pop() ?? "";
  if (name === ".env" || name.endsWith(".env")) return "ini";
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "yaml";
  return "plaintext";
}

interface EditorPanelProps {
  /** File to open when arriving via cross-view navigation (consumed once). */
  initialFilePath?: string | null;
}

export function EditorPanel({ initialFilePath }: EditorPanelProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<CuratedFiles | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [yamlError, setYamlError] = useState<YamlError | null>(null);
  const [semantic, setSemantic] = useState<SemanticValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [newPlaybookOpen, setNewPlaybookOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const saveRef = useRef<(() => void) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedInitialRef = useRef(false);

  const extraRoots = useMemo(
    () =>
      files ? [...files.playbook_roots, ...files.env_files.map((e) => e.path)] : [],
    [files],
  );

  const refreshFiles = useCallback(async (): Promise<CuratedFiles | null> => {
    try {
      const result = await invokeCmd<CuratedFiles>("curated_files");
      setFiles(result);
      return result;
    } catch (e) {
      logError("EditorPanel: curated_files")(e);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  const openFileDirect = useCallback(
    (path: string, roots: string[]) => {
      invokeCmd<FileContent>("fs_read_file", { path, extraRoots: roots })
        .then((content) => {
          if (content.kind !== "text") {
            toastError(t("editor.loadFailed"), path);
            return;
          }
          setSelectedPath(path);
          setInitialContent(content.content);
          setDirty(false);
          setYamlError(null);
          setSemantic(null);
        })
        .catch(reportError(t("editor.loadFailed")));
    },
    [t],
  );

  const requestOpen = useCallback(
    (path: string) => {
      if (path === selectedPath) return;
      if (dirty) {
        setPendingPath(path);
        return;
      }
      openFileDirect(path, extraRoots);
    },
    [selectedPath, dirty, openFileDirect, extraRoots],
  );

  // Open the file requested via cross-view navigation once the list is loaded.
  useEffect(() => {
    if (!initialFilePath || !files || consumedInitialRef.current) return;
    consumedInitialRef.current = true;
    openFileDirect(initialFilePath, [
      ...files.playbook_roots,
      ...files.env_files.map((e) => e.path),
    ]);
  }, [initialFilePath, files, openFileDirect]);

  const language: EditorLanguage = selectedPath ? languageFor(selectedPath) : "plaintext";
  const isPlaybook =
    !!selectedPath && !!files && files.playbooks.some((pb) => pb.path === selectedPath);

  const handleContentChange = useCallback(
    (content: string) => {
      setSemantic(null);
      if (language !== "yaml") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        invokeCmd<YamlError | null>("validate_yaml", { content })
          .then(setYamlError)
          .catch(logError("EditorPanel: validate_yaml"));
      }, 400);
    },
    [language],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleValidateSemantic = () => {
    if (!selectedPath) return;
    setValidating(true);
    invokeCmd<SemanticValidation>("playbook_validate_semantic", {
      path: selectedPath,
      extraRoots,
    })
      .then(setSemantic)
      .catch(reportError(t("editor.validateFailed")))
      .finally(() => setValidating(false));
  };

  const handleCreatePlaybook = (path: string) => {
    setNewPlaybookOpen(false);
    invokeCmd<void>("fs_write_file", {
      path,
      content: PLAYBOOK_TEMPLATE,
      allowCreate: true,
      extraRoots,
    })
      .then(async () => {
        toastSuccess(t("editor.playbookCreated"));
        const refreshed = await refreshFiles();
        openFileDirect(
          path,
          refreshed
            ? [...refreshed.playbook_roots, ...refreshed.env_files.map((e) => e.path)]
            : extraRoots,
        );
      })
      .catch(reportError(t("editor.createFailed")));
  };

  const fileName = selectedPath?.split("/").pop();

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1 border-b border-border p-4">
        <h1 className="text-2xl font-semibold">{t("editor.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("editor.description")}</p>
      </div>

      <div className="flex min-h-0 flex-1">
        {files ? (
          <FileListSidebar
            files={files}
            selectedPath={selectedPath}
            onSelect={requestOpen}
            onNewPlaybook={() => setNewPlaybookOpen(true)}
          />
        ) : (
          <div className="flex w-56 items-center justify-center border-r border-border">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {selectedPath && initialContent !== null ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="truncate font-mono text-sm" title={selectedPath}>
                  {fileName}
                </span>
                {dirty && <span className="text-primary">●</span>}
                <div className="ml-auto flex gap-2">
                  {isPlaybook && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleValidateSemantic}
                      disabled={validating || dirty}
                      title={dirty ? t("editor.validateSaveFirst") : undefined}
                    >
                      {validating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FlaskConical className="h-3.5 w-3.5" />
                      )}
                      {t("editor.validate")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => saveRef.current?.()}
                    disabled={!dirty}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {t("editor.save")}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <EditorView
                  path={selectedPath}
                  initialContent={initialContent}
                  language={language}
                  extraRoots={extraRoots}
                  onDirtyChange={setDirty}
                  onContentChange={handleContentChange}
                  onSaved={() => toastSuccess(t("editor.saved"))}
                  onSaveError={(err) => toastError(t("editor.saveFailed"), err)}
                  saveRef={saveRef}
                  yamlError={yamlError}
                />
              </div>

              <ValidationPanel
                yamlError={yamlError}
                semantic={semantic}
                validating={validating}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {t("editor.noFileSelected")}
            </div>
          )}
        </div>
      </div>

      {files && (
        <NewPlaybookDialog
          open={newPlaybookOpen}
          roots={files.playbook_roots}
          existingNames={files.playbooks.map((pb) => pb.name)}
          onClose={() => setNewPlaybookOpen(false)}
          onCreate={handleCreatePlaybook}
        />
      )}

      <UnsavedChangesDialog
        open={pendingPath !== null}
        onSave={() => {
          saveRef.current?.();
          if (pendingPath) openFileDirect(pendingPath, extraRoots);
          setPendingPath(null);
        }}
        onDiscard={() => {
          if (pendingPath) openFileDirect(pendingPath, extraRoots);
          setPendingPath(null);
        }}
        onCancel={() => setPendingPath(null)}
      />
    </div>
  );
}
