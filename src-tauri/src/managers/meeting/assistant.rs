use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::managers::history::HistoryManager;
use crate::settings::get_settings;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatMessage {
    pub role: String, // "user", "assistant", "system", "tool"
    pub content: String,
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
}

pub struct WebSearcher;

impl WebSearcher {
    /// Performs a non-blocking web search query using public search APIs (DuckDuckGo & Wikipedia).
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
    /// Ask a question to the Meeting Assistant with read-only tools (past meetings, live transcript, web search).
    pub async fn ask(
        app_handle: &AppHandle,
        request: AssistantQueryRequest,
    ) -> Result<AssistantResponse, String> {
        let settings = get_settings(app_handle);

        // Resolve active LLM provider, base URL, model name, and API key
        let (base_url, model, api_key) = Self::resolve_llm_credentials(&settings)?;

        let history_manager = app_handle.try_state::<Arc<HistoryManager>>();

        // Available read-only tools
        let tools = serde_json::json!([
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

        let system_prompt = "You are the Babbl Meeting Intelligence Assistant, an executive copilot embedded in Babbl.\n\
            CAPABILITIES:\n\
            1. Current Meeting Awareness: You can access the live meeting transcript and answer questions about what participants or the user have said.\n\
            2. Cross-Meeting Memory: You can search past meetings in the local SQLite database to retrieve past agreements, dates, attendees, and discussions.\n\
            3. Live Web Verification: You can search the web to verify facts, regulations, standards, or claims and provide clickable Markdown citation links [Source](URL).\n\n\
            GUIDELINES:\n\
            - When answering questions about past meetings or previous decisions, ALWAYS call `search_past_meetings`.\n\
            - When asked to verify a fact, check a regulation/standard (e.g., ISO, GDPR, SOC2), or find links, ALWAYS call `web_search_verification` and embed citation links into your response.\n\
            - When you receive tool outputs, immediately synthesize them into your final response for the user. Do not invoke tools in an infinite loop.\n\
            - Always be concise, direct, helpful, and structure your responses with clean Markdown.";

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
                        "CURRENT ONGOING MEETING TRANSCRIPT ({:.1}s elapsed, {} spoken turns):\n{}",
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
                    "content": format!("CURRENT ONGOING MEETING TRANSCRIPT:\n{}\n\n(Use this transcript to answer questions about what participants or you have said)", current_tx.trim())
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

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let mut tools_used = Vec::new();
        let max_rounds = 4;
        let mut final_content = String::new();

        let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));

        // Agent loop (tool execution and synthesis)
        for _round in 0..max_rounds {
            let body = serde_json::json!({
                "model": model,
                "messages": messages,
                "tools": tools,
                "tool_choice": "auto",
                "temperature": 0.3
            });

            let resp = client
                .post(&endpoint)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("LLM API request error: {}", e))?;

            if !resp.status().is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                return Err(format!("LLM API error ({}): {}", endpoint, err_text));
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
                let cleaned_reply = crate::llm_client::strip_reasoning_blocks(&content);
                return Ok(AssistantResponse {
                    reply: cleaned_reply,
                    tools_used,
                });
            }
        }

        if !final_content.trim().is_empty() {
            let cleaned_reply = crate::llm_client::strip_reasoning_blocks(&final_content);
            Ok(AssistantResponse {
                reply: cleaned_reply,
                tools_used,
            })
        } else {
            Err("No response generated by assistant".to_string())
        }
    }

    /// Resolves (base_url, model, api_key) using the configured Refine/LLM provider.
    fn resolve_llm_credentials(settings: &crate::settings::AppSettings) -> Result<(String, String, String), String> {
        let mut candidates = Vec::new();

        // 1. Check active post-processing / refine provider
        if let Some(p) = settings.active_post_process_provider() {
            candidates.push(p.clone());
        }

        // 2. Check online provider
        if let Some(p) = settings.post_process_providers.iter().find(|p| p.id == settings.online_provider_id) {
            if !candidates.iter().any(|c| c.id == p.id) {
                candidates.push(p.clone());
            }
        }

        // 3. Add all remaining configured providers
        for p in &settings.post_process_providers {
            if !candidates.iter().any(|c| c.id == p.id) {
                candidates.push(p.clone());
            }
        }

        // Find the first candidate with an API key
        for provider in candidates {
            let mut api_key = settings
                .post_process_api_keys
                .get(&provider.id)
                .cloned()
                .unwrap_or_default();

            if api_key.trim().is_empty() {
                if let Some(alt_key) = settings.online_provider_api_keys.get(&provider.id) {
                    api_key = alt_key.clone();
                }
            }

            // Environment variable fallbacks for developer convenience
            if api_key.trim().is_empty() {
                if provider.id == "groq" {
                    api_key = std::env::var("GROQ_API_KEY").unwrap_or_default();
                } else if provider.id == "openai" {
                    api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
                } else if provider.id == "gemini" {
                    api_key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
                } else if provider.id == "openrouter" {
                    api_key = std::env::var("OPENROUTER_API_KEY").unwrap_or_default();
                } else if provider.id == "custom" {
                    api_key = "local-key".to_string(); // Local Ollama/custom server
                }
            }

            if !api_key.trim().is_empty() {
                let mut model = settings
                    .post_process_models
                    .get(&provider.id)
                    .cloned()
                    .unwrap_or_default();

                if model.trim().is_empty() {
                    model = match provider.id.as_str() {
                        "groq" => "openai/gpt-oss-120b".to_string(),
                        "openai" => "gpt-4o-mini".to_string(),
                        "gemini" => "gemini-1.5-flash".to_string(),
                        "openrouter" => "meta-llama/llama-3.1-8b-instruct".to_string(),
                        "cerebras" => "llama3.1-8b".to_string(),
                        _ => "llama-3.1-8b-instant".to_string(),
                    };
                }

                let base_url = if provider.base_url.trim().is_empty() {
                    match provider.id.as_str() {
                        "groq" => "https://api.groq.com/openai/v1".to_string(),
                        "openai" => "https://api.openai.com/v1".to_string(),
                        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai".to_string(),
                        "openrouter" => "https://openrouter.ai/api/v1".to_string(),
                        "cerebras" => "https://api.cerebras.ai/v1".to_string(),
                        "custom" => "http://localhost:11434/v1".to_string(),
                        _ => "https://api.groq.com/openai/v1".to_string(),
                    }
                } else {
                    provider.base_url.clone()
                };

                return Ok((base_url, model, api_key));
            }
        }

        Err("No API key configured for any LLM provider (Groq, OpenAI, Gemini, etc.). Please add an API key in Settings -> Inference or Refine.".to_string())
    }
}
