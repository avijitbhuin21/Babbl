import React, { useState, useEffect } from "react";
import {
  Folder,
  FileCode,
  FileText,
  File,
  Play,
  RefreshCw,
  FolderOpen,
  Plus,
  Save,
  X,
  Terminal,
  Loader2,
  Check,
  AlertCircle,
  FileCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  commands,
  type WorkspaceFileEntry,
  type CodeExecutionResult,
} from "@/bindings";
import { Button } from "../../ui/Button";

export const WorkspaceManagerView: React.FC = () => {
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [activeTab, setActiveTab] = useState<"files" | "runner">("files");

  // Selected file for viewer / editor
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileEntry | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);

  // New file modal
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileInitialContent, setNewFileInitialContent] = useState("");

  // Code runner state
  const [runLanguage, setRunLanguage] = useState<"python" | "node" | "powershell">("python");
  const [runCode, setRunCode] = useState<string>(
    `# Python script running in assistant_workspace/\nimport os\nimport sys\n\nprint("Current working directory:", os.getcwd())\nprint("Python version:", sys.version)\n\nfiles = os.listdir(".")\nprint(f"Files in workspace ({len(files)}):")\nfor f in files:\n    print(f" - {f}")\n`
  );
  const [isRunningCode, setIsRunningCode] = useState(false);
  const [executionResult, setExecutionResult] = useState<CodeExecutionResult | null>(null);

  const fetchFiles = async () => {
    setIsLoadingFiles(true);
    try {
      const res = await commands.getWorkspaceFiles(null);
      if (res.status === "ok") {
        setFiles(res.data);
      } else {
        toast.error(`Failed to load workspace files: ${res.error}`);
      }
    } catch (e: any) {
      console.warn("Error fetching workspace files:", e);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleOpenFolder = async () => {
    try {
      const res = await commands.openWorkspaceFolder();
      if (res.status === "ok") {
        toast.success("Opened assistant_workspace in File Explorer");
      } else {
        toast.error(`Failed to open folder: ${res.error}`);
      }
    } catch (e: any) {
      toast.error(`Error opening workspace folder: ${e?.message || e}`);
    }
  };

  const handleSelectFile = async (file: WorkspaceFileEntry) => {
    if (file.is_dir) return;
    setSelectedFile(file);
    setIsLoadingContent(true);
    try {
      const res = await commands.readWorkspaceFile(file.relative_path);
      if (res.status === "ok") {
        setFileContent(res.data);
      } else {
        toast.error(`Failed to read file: ${res.error}`);
        setFileContent("");
      }
    } catch (e: any) {
      toast.error(`Error reading file: ${e?.message || e}`);
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    setIsSavingContent(true);
    try {
      const res = await commands.writeWorkspaceFile(selectedFile.relative_path, fileContent);
      if (res.status === "ok") {
        toast.success(`Saved ${selectedFile.name}`);
        fetchFiles();
      } else {
        toast.error(`Failed to save: ${res.error}`);
      }
    } catch (e: any) {
      toast.error(`Error saving: ${e?.message || e}`);
    } finally {
      setIsSavingContent(false);
    }
  };

  const handleCreateNewFile = async () => {
    const cleanPath = newFilePath.trim();
    if (!cleanPath) {
      toast.error("Please enter a valid file path");
      return;
    }
    try {
      const res = await commands.writeWorkspaceFile(cleanPath, newFileInitialContent);
      if (res.status === "ok") {
        toast.success(`Created file ${cleanPath}`);
        setShowNewFileModal(false);
        setNewFilePath("");
        setNewFileInitialContent("");
        fetchFiles();
      } else {
        toast.error(`Failed to create file: ${res.error}`);
      }
    } catch (e: any) {
      toast.error(`Error creating file: ${e?.message || e}`);
    }
  };

  const handleRunCurrentFile = async () => {
    if (!selectedFile) return;
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    let lang = "python";
    if (ext === "js" || ext === "ts") lang = "node";
    else if (ext === "ps1") lang = "powershell";
    else if (ext === "py") lang = "python";
    else {
      toast.error("File is not a supported executable script (.py, .js, .ps1)");
      return;
    }

    setIsRunningCode(true);
    toast.info(`Executing ${selectedFile.name} with ${lang}...`);
    try {
      const res = await commands.executeWorkspaceCode(lang, fileContent);
      if (res.status === "ok") {
        setExecutionResult(res.data);
        setActiveTab("runner");
        if (res.data.success) {
          toast.success(`${selectedFile.name} executed successfully!`);
        } else {
          toast.error(`${selectedFile.name} finished with non-zero exit code (${res.data.exit_code})`);
        }
      } else {
        toast.error(`Execution error: ${res.error}`);
      }
    } catch (e: any) {
      toast.error(`Execution error: ${e?.message || e}`);
    } finally {
      setIsRunningCode(false);
    }
  };

  const handleRunCode = async () => {
    if (!runCode.trim()) {
      toast.error("Code is empty");
      return;
    }
    setIsRunningCode(true);
    setExecutionResult(null);
    try {
      const res = await commands.executeWorkspaceCode(runLanguage, runCode);
      if (res.status === "ok") {
        setExecutionResult(res.data);
        if (res.data.success) {
          toast.success("Script executed successfully!");
        } else {
          toast.error(`Script exited with code ${res.data.exit_code}`);
        }
        fetchFiles(); // refresh in case script created files
      } else {
        toast.error(`Execution error: ${res.error}`);
      }
    } catch (e: any) {
      toast.error(`Error executing code: ${e?.message || e}`);
    } finally {
      setIsRunningCode(false);
    }
  };

  const getFileIcon = (file: WorkspaceFileEntry) => {
    if (file.is_dir) return <Folder className="w-4 h-4 text-amber-400" />;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (["py", "js", "ts", "ps1", "sh"].includes(ext || "")) {
      return <FileCode className="w-4 h-4 text-blue-400" />;
    }
    if (["md", "txt", "json", "csv"].includes(ext || "")) {
      return <FileText className="w-4 h-4 text-emerald-400" />;
    }
    return <File className="w-4 h-4 text-neutral-400" />;
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Workspace Header */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Folder className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-semibold text-neutral-100">
              Autonomous Assistant Workspace
            </h2>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
              assistant_workspace/
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            The AI assistant and user have full access to create, read, write files, subfolders, and run Python, Node.js, and PowerShell code.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchFiles}
            disabled={isLoadingFiles}
            className="h-8 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer bg-neutral-800 text-neutral-200 border border-neutral-700 hover:bg-neutral-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? "animate-spin text-primary-400" : ""}`} />
            <span>Refresh</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleOpenFolder}
            className="h-8 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer bg-neutral-800 text-neutral-200 border border-neutral-700 hover:bg-neutral-700"
            title="Open assistant_workspace folder in Windows Explorer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Open in Explorer</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowNewFileModal(true)}
            className="h-8 px-3 text-xs flex items-center gap-1.5 cursor-pointer bg-primary-600 hover:bg-primary-500 text-white font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New File</span>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-2">
        <button
          onClick={() => setActiveTab("files")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
            activeTab === "files"
              ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60"
          }`}
        >
          <Folder className="w-3.5 h-3.5" />
          <span>Workspace Files ({files.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("runner")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
            activeTab === "runner"
              ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60"
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Code Runner Terminal</span>
        </button>
      </div>

      {/* Tab 1: Files Explorer */}
      {activeTab === "files" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Files List */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 flex flex-col h-[460px]">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-800 text-xs font-medium text-neutral-400">
              <span>Name</span>
              <span>Size</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pr-1 text-xs">
              {files.length === 0 ? (
                <div className="text-center py-12 text-neutral-500 italic text-xs">
                  No files yet. The assistant can auto-generate code and notes here, or you can create one.
                </div>
              ) : (
                files.map((file) => {
                  const isSelected = selectedFile?.relative_path === file.relative_path;
                  return (
                    <div
                      key={file.relative_path}
                      onClick={() => handleSelectFile(file)}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${
                        isSelected
                          ? "bg-primary-500/20 border border-primary-500/40 text-neutral-100"
                          : "hover:bg-neutral-800/60 text-neutral-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate pr-2">
                        {getFileIcon(file)}
                        <span className="truncate font-mono text-[11px]">{file.relative_path}</span>
                      </div>
                      <span className="text-[10px] text-neutral-500 font-mono shrink-0">
                        {file.is_dir ? "DIR" : formatBytes(file.size_bytes)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* File Inspector / Editor */}
          <div className="md:col-span-2 bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col h-[460px]">
            {selectedFile ? (
              <>
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800">
                  <div className="flex items-center gap-2 truncate">
                    {getFileIcon(selectedFile)}
                    <span className="font-mono text-xs font-semibold text-neutral-200 truncate">
                      {selectedFile.relative_path}
                    </span>
                    <span className="text-[10px] text-neutral-500 font-mono">
                      ({formatBytes(selectedFile.size_bytes)})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {["py", "js", "ts", "ps1"].includes(
                      selectedFile.name.split(".").pop()?.toLowerCase() || ""
                    ) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRunCurrentFile}
                        disabled={isRunningCode}
                        className="h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
                        title="Execute this script directly in workspace"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Run</span>
                      </Button>
                    )}

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSaveFile}
                      disabled={isSavingContent}
                      className="h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer bg-primary-600 hover:bg-primary-500 text-white"
                    >
                      {isSavingContent ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Save className="w-3 h-3" />
                      )}
                      <span>Save</span>
                    </Button>

                    <button
                      onClick={() => setSelectedFile(null)}
                      className="text-neutral-500 hover:text-neutral-300 p-1 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isLoadingContent ? (
                  <div className="flex-1 flex items-center justify-center text-neutral-500 gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
                    <span className="text-xs">Loading file...</span>
                  </div>
                ) : (
                  <textarea
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    className="flex-1 w-full bg-neutral-950 font-mono text-[11px] text-neutral-200 p-3 rounded-lg border border-neutral-800/80 focus:outline-none focus:border-primary-500/80 resize-none leading-relaxed selection:bg-neutral-800"
                    placeholder="File content..."
                    spellCheck={false}
                  />
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 space-y-2">
                <FileCode className="w-8 h-8 text-neutral-600" />
                <p className="text-xs">Select a file from the left to view, edit, or execute.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Code Runner Terminal */}
      {activeTab === "runner" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Editor & Controls */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col h-[460px]">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-primary-400" />
                <span className="text-xs font-semibold text-neutral-200">
                  Script Runner
                </span>
                <select
                  value={runLanguage}
                  onChange={(e) => setRunLanguage(e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-primary-500"
                >
                  <option value="python">Python (python)</option>
                  <option value="node">Node.js (node)</option>
                  <option value="powershell">PowerShell (powershell)</option>
                </select>
              </div>

              <Button
                variant="primary"
                size="sm"
                onClick={handleRunCode}
                disabled={isRunningCode}
                className="h-7 px-3 text-xs flex items-center gap-1.5 cursor-pointer bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              >
                {isRunningCode ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Running...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    <span>Execute Script</span>
                  </>
                )}
              </Button>
            </div>

            <textarea
              value={runCode}
              onChange={(e) => setRunCode(e.target.value)}
              className="flex-1 w-full bg-neutral-950 font-mono text-[11px] text-neutral-100 p-3 rounded-lg border border-neutral-800 focus:outline-none focus:border-primary-500/80 resize-none leading-relaxed selection:bg-neutral-800"
              spellCheck={false}
              placeholder="Write Python, Node.js, or PowerShell code here..."
            />
          </div>

          {/* Terminal Output */}
          <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 flex flex-col h-[460px] font-mono text-xs">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-800 text-neutral-400 text-[11px]">
              <span className="flex items-center gap-1.5 font-semibold text-neutral-300">
                <Terminal className="w-3.5 h-3.5 text-neutral-400" />
                Output Console
              </span>
              {executionResult && (
                <div className="flex items-center gap-2">
                  <span
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                      executionResult.success
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : "bg-red-500/15 text-red-400 border-red-500/30"
                    }`}
                  >
                    {executionResult.success ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <AlertCircle className="w-3 h-3" />
                    )}
                    Exit Code: {executionResult.exit_code}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 select-text">
              {isRunningCode ? (
                <div className="flex items-center justify-center h-full text-neutral-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
                  <span>Executing script in assistant_workspace/...</span>
                </div>
              ) : executionResult ? (
                <>
                  {executionResult.stdout && (
                    <div>
                      <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
                        STDOUT:
                      </div>
                      <pre className="text-emerald-300/90 whitespace-pre-wrap leading-relaxed text-[11px] bg-neutral-900/50 p-2.5 rounded border border-neutral-800/80">
                        {executionResult.stdout}
                      </pre>
                    </div>
                  )}

                  {executionResult.stderr && (
                    <div>
                      <div className="text-[10px] text-red-400 uppercase tracking-wider mb-1">
                        STDERR:
                      </div>
                      <pre className="text-red-300 whitespace-pre-wrap leading-relaxed text-[11px] bg-red-950/20 p-2.5 rounded border border-red-900/40">
                        {executionResult.stderr}
                      </pre>
                    </div>
                  )}

                  {!executionResult.stdout && !executionResult.stderr && (
                    <div className="text-neutral-500 italic py-8 text-center text-xs">
                      Process completed with no output.
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-neutral-600 text-xs">
                  <Terminal className="w-8 h-8 mb-2 opacity-50" />
                  <span>Output will appear here after executing code.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New File Modal */}
      {showNewFileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-primary-400" />
                Create New File in Workspace
              </h3>
              <button
                onClick={() => setShowNewFileModal(false)}
                className="text-neutral-400 hover:text-neutral-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-neutral-300 font-medium mb-1">
                  Relative File Path (e.g. <code>scripts/analysis.py</code>)
                </label>
                <input
                  type="text"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="e.g. data_summary.py or notes.md"
                  className="w-full bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-primary-500 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-neutral-300 font-medium mb-1">
                  Initial Content (optional)
                </label>
                <textarea
                  value={newFileInitialContent}
                  onChange={(e) => setNewFileInitialContent(e.target.value)}
                  rows={4}
                  placeholder="# Initial code or text"
                  className="w-full bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-primary-500 text-xs font-mono resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-neutral-800">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNewFileModal(false)}
                className="text-xs text-neutral-400 hover:text-neutral-200"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateNewFile}
                className="text-xs bg-primary-600 hover:bg-primary-500 text-white font-medium px-3 py-1.5"
              >
                Create File
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
