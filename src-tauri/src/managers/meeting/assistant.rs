use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::managers::history::HistoryManager;
use crate::settings::get_settings;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatMessage {
    pub role: String, // "user", "assistant", "system"
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct WorkspaceFileEntry {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct CodeExecutionResult {
    pub language: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct SearchResult {
    pub title: String,
    pub snippet: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct AssistantQueryRequest {
    pub query: String,
    pub current_transcript: Option<String>,
    pub history: Vec<ChatMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct AssistantResponse {
    pub reply: String,
    pub tools_used: Vec<String>,
    pub workspace_files: Vec<WorkspaceFileEntry>,
}

pub struct WorkspaceManager;

impl WorkspaceManager {
    /// Resolves the dedicated assistant workspace directory.
    /// Prefers a workspace folder in the project/working directory, falling back to app_data_dir.
    pub fn get_workspace_dir(app_handle: &AppHandle) -> PathBuf {
        let preferred = PathBuf::from("assistant_workspace");
        if preferred.exists() || fs::create_dir_all(&preferred).is_ok() {
            if let Ok(abs) = fs::canonicalize(&preferred) {
                return abs;
            }
            return preferred;
        }

        // Fallback to app_data_dir
        let fallback = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("assistant_workspace");
        let _ = fs::create_dir_all(&fallback);
        fallback
    }

    /// Recursively lists files in the workspace or a specified subpath.
    pub fn list_files(
        workspace: &Path,
        subpath: Option<&str>,
    ) -> Result<Vec<WorkspaceFileEntry>, String> {
        let target_dir = match subpath {
            Some(sub) if !sub.trim().is_empty() => {
                let p = workspace.join(sub.trim_start_matches(['/', '\\']));
                if !p.starts_with(workspace) {
                    return Err("Access denied: path escapes workspace".to_string());
                }
                p
            }
            _ => workspace.to_path_buf(),
        };

        if !target_dir.exists() {
            let _ = fs::create_dir_all(&target_dir);
        }

        let mut entries = Vec::new();
        Self::collect_entries(workspace, &target_dir, &mut entries)?;
        entries.sort_by(|a, b| {
            if a.is_dir == b.is_dir {
                a.name.cmp(&b.name)
            } else if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });

        Ok(entries)
    }

    fn collect_entries(
        root: &Path,
        current: &Path,
        out: &mut Vec<WorkspaceFileEntry>,
    ) -> Result<(), String> {
        let read_dir = fs::read_dir(current).map_err(|e| format!("Failed to read directory: {}", e))?;
        for entry in read_dir.flatten() {
            let path = entry.path();
            let is_dir = path.is_dir();
            let metadata = entry.metadata().ok();
            let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_at = metadata
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let dt: DateTime<Utc> = t.into();
                    dt.format("%Y-%m-%d %H:%M:%S").to_string()
                })
                .unwrap_or_else(|| "Unknown".to_string());

            let name = entry.file_name().to_string_lossy().to_string();
            let relative_path = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());

            out.push(WorkspaceFileEntry {
                name,
                relative_path,
                is_dir,
                size_bytes,
                modified_at,
            });

            if is_dir {
                let _ = Self::collect_entries(root, &path, out);
            }
        }
        Ok(())
    }

    /// Reads content of a workspace file.
    pub fn read_file(workspace: &Path, relative_path: &str) -> Result<String, String> {
        let clean = relative_path.trim().trim_start_matches(['/', '\\']);
        let full_path = workspace.join(clean);

        if !full_path.starts_with(workspace) {
            return Err("Access denied: path escapes workspace".to_string());
        }

        if !full_path.exists() {
            return Err(format!("File '{}' not found in workspace", clean));
        }

        fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))
    }

    /// Writes or creates a file in the workspace.
    pub fn write_file(
        workspace: &Path,
        relative_path: &str,
        content: &str,
    ) -> Result<(), String> {
        let clean = relative_path.trim().trim_start_matches(['/', '\\']);
        let full_path = workspace.join(clean);

        if !full_path.starts_with(workspace) {
            return Err("Access denied: path escapes workspace".to_string());
        }

        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }

        fs::write(&full_path, content).map_err(|e| format!("Failed to write file: {}", e))?;
        log::info!("Workspace file written: {:?}", full_path);
        Ok(())
    }

    /// Runs code (Python, JavaScript/Node, or PowerShell) inside the workspace folder.
    pub async fn execute_code(
        workspace: &Path,
        language: &str,
        code: &str,
    ) -> Result<CodeExecutionResult, String> {
        let lang = language.to_lowercase().trim().to_string();
        log::info!("Executing workspace code [{}]: {} chars", lang, code.len());

        let mut child_cmd = match lang.as_str() {
            "python" | "py" => {
                let mut cmd = Command::new("python");
                cmd.arg("-c").arg(code);
                cmd
            }
            "javascript" | "js" | "node" => {
                let mut cmd = Command::new("node");
                cmd.arg("-e").arg(code);
                cmd
            }
            "powershell" | "ps1" | "shell" => {
                let mut cmd = Command::new("powershell");
                cmd.arg("-NoProfile").arg("-Command").arg(code);
                cmd
            }
            _ => {
                return Err(format!(
                    "Unsupported execution language '{}'. Supported: python, node, powershell",
                    lang
                ));
            }
        };

        child_cmd.current_dir(workspace);
        child_cmd.stdout(Stdio::piped());
        child_cmd.stderr(Stdio::piped());

        let child = child_cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn {} process: {}", lang, e))?;

        // 25s timeout
        let output = match tokio::time::timeout(Duration::from_secs(25), child.wait_with_output()).await {
            Ok(res) => res.map_err(|e| format!("Execution failed: {}", e))?,
            Err(_) => {
                return Err("Code execution timed out after 25 seconds".to_string());
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);
        let success = output.status.success();

        Ok(CodeExecutionResult {
            language: lang,
            stdout,
            stderr,
            exit_code,
            success,
        })
    }
}

pub struct WebSearcher;

impl WebSearcher {
    /// Queries public search APIs (DuckDuckGo + Wikipedia) for real-time verification and citation links.
    pub async fn search(query: &str) -> Result<Vec<SearchResult>, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();

        // 1. DuckDuckGo Instant Answer API
        let ddg_url = match reqwest::Url::parse_with_params(
            "https://api.duckduckgo.com/",
            &[("q", query.trim()), ("format", "json"), ("no_html", "1")],
        ) {
            Ok(u) => u,
            Err(e) => return Err(format!("Invalid URL: {}", e)),
        };

        if let Ok(resp) = client.get(ddg_url).header("User-Agent", "BabblAssistant/1.0").send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let abstract_text = json["AbstractText"].as_str().unwrap_or("").trim();
                let abstract_url = json["AbstractURL"].as_str().unwrap_or("").trim();
                let heading = json["Heading"].as_str().unwrap_or(query).trim();

                if !abstract_text.is_empty() && !abstract_url.is_empty() {
                    results.push(SearchResult {
                        title: heading.to_string(),
                        snippet: abstract_text.to_string(),
                        url: abstract_url.to_string(),
                    });
                }

                // Check RelatedTopics
                if let Some(topics) = json["RelatedTopics"].as_array() {
                    for topic in topics.iter().take(3) {
                        if let (Some(text), Some(first_url)) = (topic["Text"].as_str(), topic["FirstURL"].as_str()) {
                            if !text.trim().is_empty() && !first_url.trim().is_empty() {
                                results.push(SearchResult {
                                    title: text.chars().take(60).collect(),
                                    snippet: text.to_string(),
                                    url: first_url.to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // 2. Wikipedia OpenSearch API for definitions, standards, laws, technical topics
        let wiki_url = match reqwest::Url::parse_with_params(
            "https://en.wikipedia.org/w/api.php",
            &[
                ("action", "opensearch"),
                ("search", query.trim()),
                ("limit", "3"),
                ("namespace", "0"),
                ("format", "json"),
            ],
        ) {
            Ok(u) => u,
            Err(e) => return Err(format!("Invalid URL: {}", e)),
        };

        if let Ok(resp) = client.get(wiki_url).header("User-Agent", "BabblAssistant/1.0").send().await {
            if let Ok(arr) = resp.json::<serde_json::Value>().await {
                if let (Some(titles), Some(snippets), Some(urls)) = (
                    arr.get(1).and_then(|v| v.as_array()),
                    arr.get(2).and_then(|v| v.as_array()),
                    arr.get(3).and_then(|v| v.as_array()),
                ) {
                    for i in 0..titles.len() {
                        let t = titles[i].as_str().unwrap_or("").trim();
                        let s = snippets.get(i).and_then(|v| v.as_str()).unwrap_or("").trim();
                        let u = urls.get(i).and_then(|v| v.as_str()).unwrap_or("").trim();
                        if !t.is_empty() && !u.is_empty() {
                            results.push(SearchResult {
                                title: t.to_string(),
                                snippet: if s.is_empty() { format!("Wikipedia article for {}", t) } else { s.to_string() },
                                url: u.to_string(),
                            });
                        }
                    }
                }
            }
        }

        if results.is_empty() {
            let fallback_url = format!("https://duckduckgo.com/?q={}", query.trim().replace(' ', "+"));
            results.push(SearchResult {
                title: format!("Web search for '{}'", query),
                snippet: "Direct web search query on DuckDuckGo".to_string(),
                url: fallback_url,
            });
        }

        Ok(results)
    }
}

pub struct MeetingAssistantAgent;

impl MeetingAssistantAgent {
    /// Dispatches an intelligent query to the Groq LLM with autonomous tool execution.
    pub async fn ask(
        app_handle: &AppHandle,
        request: AssistantQueryRequest,
    ) -> Result<AssistantResponse, String> {
        let settings = get_settings(app_handle);
        let workspace = WorkspaceManager::get_workspace_dir(app_handle);

        let groq_key = settings
            .post_process_api_keys
            .get("groq")
            .cloned()
            .or_else(|| settings.online_provider_api_keys.get("groq").cloned())
            .or_else(|| std::env::var("GROQ_API_KEY").ok())
            .unwrap_or_default();

        if groq_key.trim().is_empty() {
            return Err("Groq API key not configured. Please add your Groq API key in Cloud Models settings.".to_string());
        }

        let model = settings
            .post_process_models
            .get("groq")
            .cloned()
            .unwrap_or_else(|| "openai/gpt-oss-120b".to_string());

        let history_manager = app_handle.try_state::<Arc<HistoryManager>>();

        // Available tools specification for Groq LLM
        let tools = serde_json::json!([
            {
                "type": "function",
                "function": {
                    "name": "workspace_write_file",
                    "description": "Create or update a file or script inside the assistant's dedicated workspace directory",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "Relative file path inside workspace (e.g. 'notes.md', 'scripts/verify.py')" },
                            "content": { "type": "string", "description": "Full file content to write" }
                        },
                        "required": ["path", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "workspace_read_file",
                    "description": "Read content of a file inside the assistant's workspace directory",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "Relative file path inside workspace" }
                        },
                        "required": ["path"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "workspace_list_files",
                    "description": "List all files and subfolders created in the assistant workspace directory",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "subpath": { "type": "string", "description": "Optional subdirectory to list" }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "workspace_execute_code",
                    "description": "Run Python, Node.js, or PowerShell code inside the workspace directory and get stdout/stderr results",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "language": { "type": "string", "enum": ["python", "node", "powershell"], "description": "Language runtime" },
                            "code": { "type": "string", "description": "Code string to execute" }
                        },
                        "required": ["language", "code"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "search_past_meetings",
                    "description": "Search past meeting history database for previous decisions, topics, dates, attendee lists, or full transcripts",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": { "type": "string", "description": "Topic, decision, standard, or keyword to search for" }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "web_search_verification",
                    "description": "Search the live web to verify statements, regulations, standards, or facts and get real citation URLs",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": { "type": "string", "description": "Search phrase to verify on the web" }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_live_meeting_transcript",
                    "description": "Fetch the latest real-time transcript of the ongoing meeting currently taking place in Babbl",
                    "parameters": {
                        "type": "object",
                        "properties": {}
                    }
                }
            }
        ]);

        let mut messages: Vec<serde_json::Value> = Vec::new();

        let system_prompt = format!(
            "You are Babbl Live Meeting Assistant, an executive AI copilot embedded in Babbl desktop app.\n\
            Workspace path: {}\n\n\
            CAPABILITIES:\n\
            1. Current Meeting Awareness: You can read the live meeting transcript and answer questions about what is being discussed in real-time.\n\
            2. Autonomous Workspace: You have your own dedicated folder. You can write files, read files, list files, and execute Python/Node/PowerShell code.\n\
            3. Cross-Meeting Memory: You can search past meetings to tell the user when decisions were taken, who attended, and what was discussed.\n\
            4. Live Web Verification: You can search the web to verify facts, compliance standards, or figures and provide direct markdown citation links.\n\n\
            GUIDELINES:\n\
            - When answering questions about past decisions, ALWAYS call `search_past_meetings`.\n\
            - When asked to verify a fact, check a standard (e.g. ISO, DPDP, GDPR), or find links, ALWAYS call `web_search_verification` and embed the URLs [title](url) into your response.\n\
            - When you call a tool and receive results, immediately synthesize the results into your final response for the user with verified citation links or confirmations. Do not call tools repeatedly in a loop.\n\
            - When writing code, create files in the workspace with `workspace_write_file` and run them with `workspace_execute_code`.\n\
            - Always be concise, highly professional, direct, and structure your responses with clean Markdown.\n",
            workspace.display()
        );

        messages.push(serde_json::json!({
            "role": "system",
            "content": system_prompt
        }));

        // Inject ongoing meeting context if available
        let mut ongoing_transcript = request.current_transcript.clone();
        if ongoing_transcript.as_deref().unwrap_or("").trim().is_empty() {
            if let Some(meeting_mgr) = app_handle.try_state::<Arc<crate::managers::meeting::MeetingManager>>() {
                let lt = meeting_mgr.get_live_transcript();
                if !lt.full_text.trim().is_empty() {
                    ongoing_transcript = Some(format!(
                        "CURRENT ONGOING MEETING TRANSCRIPT (Live call context, {:.1}s elapsed, {} spoken turns):\n{}",
                        lt.duration_secs,
                        lt.segments.len(),
                        lt.full_text
                    ));
                }
            }
        }

        if let Some(ref current_tx) = ongoing_transcript {
            if !current_tx.trim().is_empty() {
                messages.push(serde_json::json!({
                    "role": "system",
                    "content": format!("CURRENT ONGOING MEETING TRANSCRIPT:\n{}\n\n(Use this transcript to answer questions about what participants or you have said during this meeting)", current_tx.trim())
                }));
            }
        }

        // Add prior conversation history
        for msg in &request.history {
            messages.push(serde_json::json!({
                "role": msg.role,
                "content": msg.content
            }));
        }

        // Add user's latest query
        messages.push(serde_json::json!({
            "role": "user",
            "content": request.query
        }));

        let client = reqwest::Client::new();
        let mut tools_used = Vec::new();
        let max_rounds = 4;
        let mut final_content = String::new();

        // Agent loop (multi-turn tool execution and synthesis)
        for _round in 0..max_rounds {
            let body = serde_json::json!({
                "model": model,
                "messages": messages,
                "tools": tools,
                "tool_choice": "auto",
                "temperature": 0.3
            });

            let resp = client
                .post("https://api.groq.com/openai/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", groq_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Groq API request error: {}", e))?;

            if !resp.status().is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                return Err(format!("Groq API error: {}", err_text));
            }

            let resp_json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

            let choice = &resp_json["choices"][0]["message"];
            let content = choice["content"].as_str().unwrap_or("").to_string();
            if !content.trim().is_empty() {
                final_content = content.clone();
            }

            // Check if tool calls were returned
            if let Some(tool_calls) = choice["tool_calls"].as_array() {
                if !tool_calls.is_empty() {
                    // Append assistant message with tool calls
                    messages.push(choice.clone());

                    for tool_call in tool_calls {
                        let call_id = tool_call["id"].as_str().unwrap_or("call_1");
                        let fn_name = tool_call["function"]["name"].as_str().unwrap_or("");
                        let fn_args_str = tool_call["function"]["arguments"].as_str().unwrap_or("{}");
                        let args: serde_json::Value =
                            serde_json::from_str(fn_args_str).unwrap_or(serde_json::json!({}));

                        log::info!("Assistant executing tool: {} with args: {}", fn_name, fn_args_str);
                        tools_used.push(fn_name.to_string());

                        let tool_result_str: String = match fn_name {
                            "workspace_write_file" => {
                                let path = args["path"].as_str().unwrap_or("notes.txt");
                                let file_content = args["content"].as_str().unwrap_or("");
                                match WorkspaceManager::write_file(&workspace, path, file_content) {
                                    Ok(_) => format!("Successfully wrote file '{}' ({} bytes). Confirm this to the user.", path, file_content.len()),
                                    Err(e) => format!("Error writing file: {}", e),
                                }
                            }
                            "workspace_read_file" => {
                                let path = args["path"].as_str().unwrap_or("");
                                match WorkspaceManager::read_file(&workspace, path) {
                                    Ok(c) => c,
                                    Err(e) => format!("Error reading file: {}", e),
                                }
                            }
                            "workspace_list_files" => {
                                let sub = args["subpath"].as_str();
                                match WorkspaceManager::list_files(&workspace, sub) {
                                    Ok(entries) => serde_json::to_string_pretty(&entries).unwrap_or_default(),
                                    Err(e) => format!("Error listing files: {}", e),
                                }
                            }
                            "workspace_execute_code" => {
                                let lang = args["language"].as_str().unwrap_or("python");
                                let code = args["code"].as_str().unwrap_or("");
                                match WorkspaceManager::execute_code(&workspace, lang, code).await {
                                    Ok(res) => format!(
                                        "Exit code: {}\nSTDOUT:\n{}\nSTDERR:\n{}\nExecution complete. Summarize output for user.",
                                        res.exit_code, res.stdout, res.stderr
                                    ),
                                    Err(e) => format!("Execution error: {}", e),
                                }
                            }
                            "search_past_meetings" => {
                                let q = args["query"].as_str().unwrap_or("");
                                if let Some(ref hm) = history_manager {
                                    match hm.get_past_meetings(Some(q)) {
                                        Ok(past) => {
                                            if past.is_empty() {
                                                format!("No past meetings matched query '{}'", q)
                                            } else {
                                                let summaries: Vec<serde_json::Value> = past
                                                    .iter()
                                                    .take(5)
                                                    .map(|m| {
                                                        serde_json::json!({
                                                            "date": m.created_at,
                                                            "title": m.title,
                                                            "duration_secs": m.duration_secs,
                                                            "participants": m.participants,
                                                            "summary": m.summary_markdown
                                                        })
                                                    })
                                                    .collect();
                                                let json_data = serde_json::to_string_pretty(&summaries).unwrap_or_default();
                                                format!("{}\n\n[INSTRUCTION]: Past meeting records retrieved. Synthesize this information and answer the user's question directly.", json_data)
                                            }
                                        }
                                        Err(e) => format!("Database query error: {}", e),
                                    }
                                } else {
                                    "Meeting history manager unavailable".to_string()
                                }
                            }
                            "web_search_verification" => {
                                let q = args["query"].as_str().unwrap_or("");
                                match WebSearcher::search(q).await {
                                    Ok(res) => {
                                        let json_data = serde_json::to_string_pretty(&res).unwrap_or_default();
                                        format!("{}\n\n[INSTRUCTION]: Search completed. Synthesize the findings above into a verified response for the user with markdown citation links [Title](URL). Do not execute more search calls.", json_data)
                                    }
                                    Err(e) => format!("Web search error: {}. Answer based on your knowledge.", e),
                                }
                            }
                            "get_live_meeting_transcript" => {
                                if let Some(meeting_mgr) = app_handle.try_state::<Arc<crate::managers::meeting::MeetingManager>>() {
                                    let lt = meeting_mgr.get_live_transcript();
                                    if lt.segments.is_empty() {
                                        "No spoken segments detected yet in the current ongoing meeting.".to_string()
                                    } else {
                                        format!("Current Ongoing Meeting Transcript ({:.1}s duration, {} segments):\n{}\n\n[INSTRUCTION]: Latest spoken turns retrieved. Answer the user's question directly.", lt.duration_secs, lt.segments.len(), lt.full_text)
                                    }
                                } else {
                                    "MeetingManager state unavailable.".to_string()
                                }
                            }
                            _ => format!("Unknown function '{}'", fn_name),
                        };

                        messages.push(serde_json::json!({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": tool_result_str
                        }));
                    }

                    // Continue loop to get the LLM's next response incorporating the tool outputs
                    continue;
                }
            }

            // If we have content and no pending tool calls, return final response!
            if !content.trim().is_empty() {
                let current_files = WorkspaceManager::list_files(&workspace, None).unwrap_or_default();
                return Ok(AssistantResponse {
                    reply: content,
                    tools_used,
                    workspace_files: current_files,
                });
            }
        }

        // If loop finished and we collected content, return it
        let current_files = WorkspaceManager::list_files(&workspace, None).unwrap_or_default();
        if !final_content.trim().is_empty() {
            return Ok(AssistantResponse {
                reply: final_content,
                tools_used,
                workspace_files: current_files,
            });
        }

        // Fallback response with any tools invoked summary
        Ok(AssistantResponse {
            reply: "I have gathered the information and executed the required tools in your workspace.".to_string(),
            tools_used,
            workspace_files: current_files,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_workspace_file_operations() {
        let temp_dir = std::env::temp_dir().join(format!("babbl_test_ws_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        let _ = fs::create_dir_all(&temp_dir);

        // 1. Write file
        let write_res = WorkspaceManager::write_file(&temp_dir, "notes/test.txt", "Hello Workspace!");
        assert!(write_res.is_ok(), "Failed to write file: {:?}", write_res);

        // 2. Read file
        let read_res = WorkspaceManager::read_file(&temp_dir, "notes/test.txt");
        assert_eq!(read_res.unwrap(), "Hello Workspace!");

        // 3. List files
        let list_res = WorkspaceManager::list_files(&temp_dir, None);
        assert!(list_res.is_ok());
        let files = list_res.unwrap();
        assert!(files.iter().any(|f| f.name == "test.txt"));

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_workspace_execute_powershell() {
        let temp_dir = std::env::temp_dir().join(format!("babbl_test_exec_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)));
        let _ = fs::create_dir_all(&temp_dir);

        let res = WorkspaceManager::execute_code(&temp_dir, "powershell", "Write-Output 'Babbl Workspace Agent'").await;
        assert!(res.is_ok(), "Execution failed: {:?}", res);
        let exec = res.unwrap();
        assert!(exec.success);
        assert!(exec.stdout.contains("Babbl Workspace Agent"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_web_searcher() {
        let res = WebSearcher::search("Rust programming language").await;
        assert!(res.is_ok(), "Web search failed: {:?}", res);
        let items = res.unwrap();
        assert!(!items.is_empty(), "Expected at least one search result");
        assert!(items.iter().any(|item| item.url.contains("rust") || item.url.contains("wikipedia")));
    }
}

