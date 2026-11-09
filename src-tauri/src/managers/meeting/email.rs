use base64::Engine;
use lettre::{
    message::{
        header::ContentType,
        Attachment, MultiPart, SinglePart,
    },
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct SendMomEmailRequest {
    pub sender_email: String,
    pub app_password: String,
    pub recipients: Vec<String>,
    pub subject: String,
    pub mom_markdown: String,
    pub pdf_base64: Option<String>,
    pub pdf_filename: Option<String>,
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn format_inline(text: &str) -> String {
    // 1. Normalize special unicode hyphens and spaces
    let normalized = text
        .replace('\u{2010}', "-")
        .replace('\u{2011}', "-") // non-breaking hyphen
        .replace('\u{2012}', "-")
        .replace('\u{2013}', "-") // en-dash
        .replace('\u{2014}', "--") // em-dash
        .replace('\u{202F}', " ") // narrow non-breaking space
        .replace('\u{00A0}', " "); // non-breaking space

    // 2. Protect deliberate <br> tags
    let with_br_placeholder = normalized
        .replace("<br>", "__BABBL_BR__")
        .replace("<br/>", "__BABBL_BR__")
        .replace("<br />", "__BABBL_BR__");

    // 3. Escape HTML
    let escaped = html_escape(&with_br_placeholder);

    // 4. Restore <br/>
    let restored_br = escaped.replace("__BABBL_BR__", "<br/>");

    // 5. Convert **bold** to <strong>...</strong>
    let mut out = String::new();
    let parts: Vec<&str> = restored_br.split("**").collect();
    for (i, part) in parts.iter().enumerate() {
        if i % 2 == 1 {
            out.push_str("<strong>");
            out.push_str(part);
            out.push_str("</strong>");
        } else {
            out.push_str(part);
        }
    }

    out
}

pub fn markdown_to_email_html(md: &str, subject: &str) -> String {
    let mut html = String::with_capacity(md.len() * 2 + 1024);
    html.push_str(r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; color: #1e293b; line-height: 1.6; }
  .email-card { max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
  .header { background: #1B211A; color: #ffffff; padding: 26px 30px; border-bottom: 3px solid #8BAE66; }
  .header h1 { margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: #ffffff; }
  .header .meta { font-size: 13px; color: #8BAE66; margin: 0; }
  .body-content { padding: 30px; font-size: 14px; }
  h2 { font-size: 16px; font-weight: 700; color: #0f172a; margin: 26px 0 10px 0; padding-bottom: 6px; border-bottom: 2px solid #f1f5f9; }
  h3 { font-size: 14px; font-weight: 600; color: #1e293b; margin: 20px 0 8px 0; }
  h4 { font-size: 13px; font-weight: 600; color: #334155; margin: 16px 0 6px 0; }
  p { margin: 0 0 12px 0; color: #334155; line-height: 1.6; }
  ul { margin: 0 0 16px 0; padding-left: 22px; color: #334155; }
  li { margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 22px 0; font-size: 13px; }
  th { background-color: #f8fafc; color: #334155; font-weight: 600; text-align: left; padding: 10px 12px; border: 1px solid #e2e8f0; }
  td { padding: 10px 12px; border: 1px solid #e2e8f0; vertical-align: top; color: #334155; line-height: 1.5; }
  tr:nth-child(even) td { background-color: #fafaf9; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 22px 0; }
  .attachment-pill { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; padding: 10px 14px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; font-weight: 500; }
  .footer { background: #f8fafc; padding: 18px 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
</style>
</head>
<body>
<div class="email-card">
  <div class="header">
"#);

    html.push_str(&format!("    <h1>{}</h1>\n", html_escape(subject)));
    html.push_str("    <p class=\"meta\">Babbl AI Meeting Minutes & Summary</p>\n");
    html.push_str("  </div>\n  <div class=\"body-content\">\n");
    html.push_str("    <div class=\"attachment-pill\">📎 Complete meeting transcript and styled report attached as PDF</div>\n");

    let mut in_table = false;
    let mut is_first_table_row = true;
    let mut in_list = false;

    for raw_line in md.lines() {
        let line = raw_line.trim();

        // Check Markdown table (| Col 1 | Col 2 |)
        if line.starts_with('|') && line.ends_with('|') {
            if in_list {
                html.push_str("</ul>\n");
                in_list = false;
            }

            let cells: Vec<&str> = line
                .split('|')
                .map(|c| c.trim())
                .filter(|c| !c.is_empty())
                .collect();

            // Skip separator row like |---|---|
            if cells.iter().all(|c| c.chars().all(|ch| ch == '-' || ch == ':' || ch == ' ')) {
                continue;
            }

            if !in_table {
                in_table = true;
                is_first_table_row = true;
                html.push_str("<table>\n");
            }

            html.push_str("  <tr>\n");
            for cell in cells {
                let cell_content = format_inline(cell);
                if is_first_table_row {
                    html.push_str(&format!("    <th>{}</th>\n", cell_content));
                } else {
                    html.push_str(&format!("    <td>{}</td>\n", cell_content));
                }
            }
            html.push_str("  </tr>\n");
            is_first_table_row = false;
            continue;
        } else if in_table {
            html.push_str("</table>\n");
            in_table = false;
        }

        if line.is_empty() {
            if in_list {
                html.push_str("</ul>\n");
                in_list = false;
            }
            continue;
        }

        // Horizontal rule
        if line == "---" || line == "***" || line == "___" {
            if in_list {
                html.push_str("</ul>\n");
                in_list = false;
            }
            html.push_str("<hr/>\n");
            continue;
        }

        // Headings
        if let Some(h4) = line.strip_prefix("#### ") {
            if in_list {
                html.push_str("</ul>\n");
                in_list = false;
            }
            html.push_str(&format!("<h4>{}</h4>\n", format_inline(h4)));
            continue;
        }
        if let Some(h3) = line.strip_prefix("### ") {
            if in_list {
                html.push_str("</ul>\n");
                in_list = false;
            }
            html.push_str(&format!("<h3>{}</h3>\n", format_inline(h3)));
            continue;
        }
        if let Some(h2) = line.strip_prefix("## ") {
            if in_list {
                html.push_str("</ul>\n");
                in_list = false;
            }
            html.push_str(&format!("<h2>{}</h2>\n", format_inline(h2)));
            continue;
        }
        if let Some(h1) = line.strip_prefix("# ") {
            if in_list {
                html.push_str("</ul>\n");
                in_list = false;
            }
            html.push_str(&format!("<h2>{}</h2>\n", format_inline(h1)));
            continue;
        }

        // Bullet list
        if line.starts_with("- ") || line.starts_with("* ") || line.starts_with("• ") {
            if !in_list {
                in_list = true;
                html.push_str("<ul>\n");
            }
            let item_text = &line[2..];
            html.push_str(&format!("  <li>{}</li>\n", format_inline(item_text)));
            continue;
        } else if in_list {
            html.push_str("</ul>\n");
            in_list = false;
        }

        // Regular paragraph
        html.push_str(&format!("<p>{}</p>\n", format_inline(line)));
    }

    if in_table {
        html.push_str("</table>\n");
    }
    if in_list {
        html.push_str("</ul>\n");
    }

    html.push_str(r#"  </div>
  <div class="footer">
    Generated automatically by Babbl · Private & Local Meeting Intelligence
  </div>
</div>
</body>
</html>
"#);

    html
}

pub async fn send_mom_email(req: SendMomEmailRequest) -> Result<(), String> {
    if req.sender_email.trim().is_empty() {
        return Err("Sender email is required.".to_string());
    }
    if req.app_password.trim().is_empty() {
        return Err("Gmail App Password is required.".to_string());
    }
    if req.recipients.is_empty() {
        return Err("At least one recipient email is required.".to_string());
    }

    // Gmail app passwords often have spaces like 'abcd efgh ijkl mnop'
    let clean_password = req.app_password.replace(' ', "");

    let creds = Credentials::new(
        req.sender_email.trim().to_string(),
        clean_password,
    );

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay("smtp.gmail.com")
        .map_err(|e| format!("SMTP configuration error: {}", e))?
        .credentials(creds)
        .build();

    let sender_addr = req.sender_email.trim();
    let html_body = markdown_to_email_html(&req.mom_markdown, &req.subject);

    // Prepare PDF attachment if provided
    let pdf_attachment: Option<SinglePart> = if let Some(ref b64) = req.pdf_base64 {
        if !b64.trim().is_empty() {
            match base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
                Ok(bytes) => {
                    let filename = req
                        .pdf_filename
                        .as_deref()
                        .filter(|f| !f.trim().is_empty())
                        .unwrap_or("Meeting_Transcript.pdf");
                    let content_type = ContentType::parse("application/pdf")
                        .unwrap_or(ContentType::TEXT_PLAIN);
                    Some(Attachment::new(filename.to_string()).body(bytes, content_type))
                }
                Err(e) => {
                    log::warn!("Failed to decode base64 PDF: {}", e);
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    for recipient in &req.recipients {
        let recipient_trimmed = recipient.trim();
        if recipient_trimmed.is_empty() {
            continue;
        }

        let builder = Message::builder()
            .from(
                format!("Babbl MOM <{}>", sender_addr)
                    .parse()
                    .map_err(|e| format!("Invalid sender address '{}': {}", sender_addr, e))?,
            )
            .to(
                recipient_trimmed
                    .parse()
                    .map_err(|e| format!("Invalid recipient address '{}': {}", recipient_trimmed, e))?,
            )
            .subject(&req.subject);

        let alternative = MultiPart::alternative()
            .singlepart(SinglePart::plain(req.mom_markdown.clone()))
            .singlepart(SinglePart::html(html_body.clone()));

        let email = if let Some(ref att) = pdf_attachment {
            let multipart = MultiPart::mixed()
                .multipart(alternative)
                .singlepart(att.clone());
            builder
                .multipart(multipart)
                .map_err(|e| format!("Failed to build multipart email message: {}", e))?
        } else {
            builder
                .multipart(alternative)
                .map_err(|e| format!("Failed to build email message: {}", e))?
        };

        mailer
            .send(email)
            .await
            .map_err(|e| format!("Failed to deliver email to '{}': {}", recipient_trimmed, e))?;
    }

    Ok(())
}
