
// src-tauri/src/compress.rs
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tree_sitter::{Language, Node, Parser, Query, QueryCursor};

// --- Types for Tauri Command ---

#[derive(Serialize)]
#[serde(untagged)]
pub enum FileResult {
    Ok(String),
    Err(String),
}

#[derive(Deserialize, Default, Debug, Clone, Copy)]
pub struct SmartCompressOptions {
    pub remove_comments: bool,
}

// --- Internal Struct for Edits ---

#[derive(Clone, Debug)]
struct Edit {
    start: usize,
    end: usize,
    replacement: String,
}

// --- Generic Helper Functions ---

fn clean_blank_lines(text: String) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut deduped_lines: Vec<&str> = Vec::new();
    for (i, &line) in lines.iter().enumerate() {
        if i > 0 && line.trim().is_empty() && lines[i - 1].trim().is_empty() {
            continue;
        }
        deduped_lines.push(line);
    }
    deduped_lines.join("\n")
}

// --- Compressor Trait (Strategy Pattern) ---

trait Compressor {
    fn compress(&self, source: &str, opts: &SmartCompressOptions) -> String;
}

// --- Python Compressor Implementation ---

struct PythonCompressor;

impl Compressor for PythonCompressor {
    fn compress(&self, source: &str, opts: &SmartCompressOptions) -> String {
        let language = tree_sitter_python::language();
        let mut parser = Parser::new();
        parser.set_language(language).expect("Error loading Python grammar");
        let tree = match parser.parse(source, None) {
            Some(t) => t,
            None => return source.to_string(),
        };

        let mut edits = Vec::new();
        let src_bytes = source.as_bytes();
        let mut cursor = tree.root_node().walk();
        
        'outer: loop {
            let node = cursor.node();

            if opts.remove_comments && node.kind() == "comment" {
                edits.push(Edit {
                    start: sol_of(src_bytes, node.start_byte()),
                    end: extend_to_eol(src_bytes, node.end_byte()),
                    replacement: String::new(),
                });
            }

            if node.kind() == "function_definition" {
                if let (Some(name), Some(body)) = (node.child_by_field_name("name"), node.child_by_field_name("body")) {
                    if &source[name.start_byte()..name.end_byte()] != "__init__" {
                        if let Some(docstring_node) = body.named_child(0).filter(|n| is_py_string_stmt(*n)) {
                            if body.named_child_count() > 1 {
                                let (_, indent) = py_body_shape_and_indent(&source[body.start_byte()..body.end_byte()]);
                                edits.push(Edit {
                                    start: docstring_node.end_byte(),
                                    end: body.end_byte(),
                                    replacement: format!("\n{}...", indent),
                                });
                            }
                        } else if body.named_child_count() > 0 {
                            let (is_multiline, indent) = py_body_shape_and_indent(&source[body.start_byte()..body.end_byte()]);
                            edits.push(Edit {
                                start: body.start_byte(),
                                end: body.end_byte(),
                                replacement: if is_multiline { format!("\n{}...", indent) } else { " ...".to_string() },
                            });
                        }
                    }
                }
            }
            
            if cursor.goto_first_child() { continue; }
            while !cursor.goto_next_sibling() {
                if !cursor.goto_parent() { break 'outer; }
            }
        }

        edits.sort_by_key(|e| e.start);
        edits.reverse();
        let mut out = source.to_string();
        for edit in edits {
            if edit.start <= edit.end && edit.end <= out.len() {
                out.replace_range(edit.start..edit.end, &edit.replacement);
            }
        }
        clean_blank_lines(out)
    }
}

fn is_py_string_stmt(node: Node) -> bool {
    let is_expr = node.kind() == "expression_statement";
    let child_kind = node.named_child(0).map(|c| c.kind());
    is_expr && matches!(child_kind, Some("string") | Some("concatenated_string"))
}
fn py_body_shape_and_indent(slice: &str) -> (bool, &str) {
    if let Some(pos) = slice.find('\n') {
        let after = &slice[pos + 1..];
        let indent_end = after.find(|c: char| !c.is_whitespace()).unwrap_or(after.len());
        (true, &after[..indent_end])
    } else { (false, "") }
}
fn sol_of(bytes: &[u8], pos: usize) -> usize {
    bytes[..pos.min(bytes.len())].iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1)
}
fn extend_to_eol(bytes: &[u8], end: usize) -> usize {
    let mut i = end;
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') { i += 1; }
    if i < bytes.len() && bytes[i] == b'\r' { i += 1; }
    if i < bytes.len() && bytes[i] == b'\n' { i += 1; }
    i
}


// --- TSX Compressor Implementation ---

struct TsxCompressor;

impl Compressor for TsxCompressor {
    fn compress(&self, source: &str, opts: &SmartCompressOptions) -> String {
        let language = tree_sitter_typescript::language_tsx();
        let mut parser = Parser::new();
        parser.set_language(language).expect("Error loading TSX grammar");
        let tree = match parser.parse(source, None) {
            Some(t) => t,
            None => return source.to_string(),
        };

        let src_bytes = source.as_bytes();
        let mut edits = Vec::new();
        
        let query_text = r#"
            (comment) @comment

            ; Find the implementation body of a hook's callback
            (call_expression
              function: (identifier) @hook_name (#match? @hook_name "^use(Callback|Memo|Effect)$")
              arguments: (arguments
                (arrow_function
                  body: (statement_block) @body
                )
              )
            )

            ; Find the implementation body of any non-component function
            (function_declaration
              name: (identifier) @func_name (#not-match? @func_name "^[A-Z]")
              body: (statement_block) @body
            )
            (lexical_declaration
              (variable_declarator
                name: (identifier) @func_name (#not-match? @func_name "^[A-Z]")
                value: (arrow_function body: (statement_block) @body)
              )
            )
        "#;
        
        let query = Query::new(language, query_text).unwrap();
        let mut cursor = QueryCursor::new();
        let matches = cursor.matches(&query, tree.root_node(), src_bytes);

        for m in matches {
            let mut captured_body: Option<Node> = None;

            for cap in m.captures {
                let capture_name = &query.capture_names()[cap.index as usize];
                match capture_name.as_str() {
                    "comment" => {
                        if opts.remove_comments {
                            edits.push(Edit {
                                start: cap.node.start_byte(),
                                end: cap.node.end_byte(),
                                replacement: String::new(),
                            });
                        }
                    },
                    "body" => captured_body = Some(cap.node),
                    _ => (),
                }
            }

            if let Some(body_node) = captured_body {
                 // Don't prune if it's already empty or just a placeholder
                if body_node.named_child_count() == 0 && body_node.child_count() <= 2 {
                    continue;
                }
                edits.push(Edit {
                    start: body_node.start_byte(),
                    end: body_node.end_byte(),
                    replacement: "{ ... }".to_string(),
                });
            }
        }
        
        edits.sort_by_key(|e| e.start);
        edits.reverse();
        let mut out = source.to_string();
        for edit in edits {
            if edit.start < edit.end && edit.end <= out.len() {
                out.replace_range(edit.start..edit.end, &edit.replacement);
            }
        }
        clean_blank_lines(out)
    }
}

// --- Compressor Factory ---

fn get_compressor_for_path(path: &str) -> Option<Box<dyn Compressor + Send + Sync>> {
    let extension = Path::new(path).extension().and_then(|s| s.to_str());
    match extension {
        Some("py") => Some(Box::new(PythonCompressor)),
        Some("ts" | "tsx") => Some(Box::new(TsxCompressor)),
        _ => None,
    }
}

// --- Tauri Command ---

#[tauri::command]
pub fn read_multiple_file_contents_compressed(
    paths: Vec<String>,
    options: Option<SmartCompressOptions>,
) -> Result<HashMap<String, FileResult>, String> {
    let opts = options.unwrap_or_default();
    let mut map = HashMap::new();

    for p in paths {
        match fs::read_to_string(&p) {
            Ok(raw) => {
                let compressed_content = if let Some(compressor) = get_compressor_for_path(&p) {
                    compressor.compress(&raw, &opts)
                } else {
                    raw // No compressor for this file type, return original content
                };
                map.insert(p, FileResult::Ok(compressed_content));
            }
            Err(e) => {
                map.insert(p.clone(), FileResult::Err(e.to_string()));
            }
        }
    }
    Ok(map)
}