import crypto from "crypto";
import path from "path";
import { estimateTokens, getChunkingParams, getModelTokenLimit } from "./tokenizer.js";

// Re-export tokenizer utilities
export { estimateTokens, getChunkingParams, getModelTokenLimit, MODEL_TOKEN_LIMITS } from "./tokenizer.js";

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generate hash for file content to detect changes
 */
export function hashContent(content) {
  return crypto.createHash("md5").update(content).digest("hex");
}

/**
 * Intelligent chunking with token limit awareness
 * Tries to split by function/class boundaries while respecting token limits
 * 
 * @param {string} content - File content to chunk
 * @param {string} file - File path (for language detection)
 * @param {object} config - Configuration object with embeddingModel
 * @returns {Array<{text: string, startLine: number, endLine: number, tokenCount: number}>}
 */
export function smartChunk(content, file, config) {
  const lines = content.split("\n");
  const chunks = [];
  const ext = path.extname(file);
  
  // Get model-specific chunking parameters
  const { targetTokens, overlapTokens } = getChunkingParams(config.embeddingModel);
  
  // Language-specific patterns for function/class detection
  const patterns = {
    // JavaScript/TypeScript
    js: /^(export\s+)?(async\s+)?(function|class|const|let|var)\s+\w+/,
    jsx: /^(export\s+)?(async\s+)?(function|class|const|let|var)\s+\w+/,
    ts: /^(export\s+)?(async\s+)?(function|class|const|let|var|interface|type)\s+\w+/,
    tsx: /^(export\s+)?(async\s+)?(function|class|const|let|var|interface|type)\s+\w+/,
    mjs: /^(export\s+)?(async\s+)?(function|class|const|let|var)\s+\w+/,
    cjs: /^(export\s+)?(async\s+)?(function|class|const|let|var)\s+\w+/,
    
    // Python
    py: /^(class|def|async\s+def)\s+\w+/,
    pyw: /^(class|def|async\s+def)\s+\w+/,
    pyx: /^(cdef|cpdef|def|class)\s+\w+/, // Cython
    
    // Java/Kotlin/Scala
    java: /^(public|private|protected)?\s*(static\s+)?(class|interface|enum|void|int|String|boolean)\s+\w+/,
    kt: /^(class|interface|object|fun|val|var)\s+\w+/,
    kts: /^(class|interface|object|fun|val|var)\s+\w+/,
    scala: /^(class|object|trait|def|val|var)\s+\w+/,
    
    // C/C++
    c: /^(struct|enum|union|void|int|char|float|double)\s+\w+/,
    cpp: /^(class|struct|namespace|template|void|int|bool)\s+\w+/,
    cc: /^(class|struct|namespace|template|void|int|bool)\s+\w+/,
    cxx: /^(class|struct|namespace|template|void|int|bool)\s+\w+/,
    h: /^(class|struct|namespace|template|void|int|bool)\s+\w+/,
    hpp: /^(class|struct|namespace|template|void|int|bool)\s+\w+/,
    hxx: /^(class|struct|namespace|template|void|int|bool)\s+\w+/,
    
    // C#
    cs: /^(public|private|protected)?\s*(static\s+)?(class|interface|struct|enum|void|int|string|bool)\s+\w+/,
    csx: /^(public|private|protected)?\s*(static\s+)?(class|interface|struct|enum|void|int|string|bool)\s+\w+/,
    
    // Go
    go: /^(func|type|const|var)\s+\w+/,
    
    // Rust
    rs: /^(pub\s+)?(fn|struct|enum|trait|impl|const|static|mod)\s+\w+/,
    
    // PHP
    php: /^(class|interface|trait|function|const)\s+\w+/,
    phtml: /^(<\?php|class|interface|trait|function)\s*/,
    
    // Ruby
    rb: /^(class|module|def)\s+\w+/,
    rake: /^(class|module|def|task|namespace)\s+\w+/,
    
    // Swift
    swift: /^(class|struct|enum|protocol|func|var|let|extension)\s+\w+/,
    
    // R
    r: /^(\w+)\s*(<-|=)\s*function/,
    R: /^(\w+)\s*(<-|=)\s*function/,
    
    // Lua
    lua: /^(function|local\s+function)\s+\w+/,
    
    // Shell scripts
    sh: /^(\w+\s*\(\)|function\s+\w+)/,
    bash: /^(\w+\s*\(\)|function\s+\w+)/,
    zsh: /^(\w+\s*\(\)|function\s+\w+)/,
    fish: /^function\s+\w+/,
    
    // CSS/Styles
    css: /^(\.|#|@media|@keyframes|@font-face|\w+)\s*[{,]/,
    scss: /^(\$\w+:|@mixin|@function|@include|\.|#|@media)\s*/,
    sass: /^(\$\w+:|=\w+|\+\w+|\.|#|@media)\s*/,
    less: /^(@\w+:|\.|\#|@media)\s*/,
    styl: /^(\$\w+\s*=|\w+\(|\.|\#)\s*/,
    
    // Markup/HTML
    html: /^(<(div|section|article|header|footer|nav|main|aside|form|table|template|script|style)\b)/i,
    htm: /^(<(div|section|article|header|footer|nav|main|aside|form|table|template|script|style)\b)/i,
    xml: /^(<\w+|\s*<!\[CDATA\[)/,
    svg: /^(<svg|<g|<path|<defs|<symbol)\b/,
    
    // Config files
    json: /^(\s*"[\w-]+"\s*:\s*[\[{])/,
    yaml: /^(\w[\w-]*:\s*[|>]?$|\w[\w-]*:\s*$)/,
    yml: /^(\w[\w-]*:\s*[|>]?$|\w[\w-]*:\s*$)/,
    toml: /^(\[\[?\w+\]?\]?|\w+\s*=)/,
    ini: /^(\[\w+\]|\w+\s*=)/,
    env: /^[A-Z_][A-Z0-9_]*=/,
    
    // Documentation
    md: /^(#{1,6}\s+|```|\*{3}|_{3})/,
    mdx: /^(#{1,6}\s+|```|import\s+|export\s+)/,
    txt: /^.{50,}/, // Split on long paragraphs
    rst: /^(={3,}|-{3,}|~{3,}|\.\.\s+\w+::)/,
    
    // Database
    sql: /^(CREATE|ALTER|INSERT|UPDATE|DELETE|SELECT|DROP|GRANT|REVOKE|WITH|DECLARE|BEGIN|END)\s+/i,
    
    // Perl
    pl: /^(sub|package|use|require)\s+\w+/,
    pm: /^(sub|package|use|require)\s+\w+/,
    
    // Vim
    vim: /^(function|command|autocmd|let\s+g:)\s*/,
  };

  const langPattern = patterns[ext.slice(1)] || patterns.js;
  let currentChunk = [];
  let chunkStartLine = 0;
  let currentTokenCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokens(line);
    
    // Check if adding this line would exceed token limit
    const wouldExceedLimit = (currentTokenCount + lineTokens) > targetTokens;
    
    // Check if this is a good split point (function/class boundary)
    const isGoodSplitPoint = 
      langPattern.test(line.trim()) && 
      currentChunk.length > 3; // At least a few lines before splitting
    
    // Split if we exceed limit OR at a good split point when near limit
    const shouldSplit = wouldExceedLimit || (isGoodSplitPoint && currentTokenCount > targetTokens * 0.6);

    if (shouldSplit && currentChunk.length > 0) {
      const chunkText = currentChunk.join("\n");
      if (chunkText.trim().length > 20) {
        chunks.push({
          text: chunkText,
          startLine: chunkStartLine + 1,
          endLine: i,
          tokenCount: currentTokenCount
        });
      }
      
      // Calculate overlap: keep last N lines that fit within overlapTokens
      let overlapLines = [];
      let overlapTokensCount = 0;
      for (let j = currentChunk.length - 1; j >= 0 && overlapTokensCount < overlapTokens; j--) {
        const lineT = estimateTokens(currentChunk[j]);
        if (overlapTokensCount + lineT <= overlapTokens) {
          overlapLines.unshift(currentChunk[j]);
          overlapTokensCount += lineT;
        } else {
          break;
        }
      }
      
      currentChunk = overlapLines;
      currentTokenCount = overlapTokensCount;
      chunkStartLine = i - overlapLines.length;
    }

    currentChunk.push(line);
    currentTokenCount += lineTokens;
  }

  // Add remaining chunk
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join("\n");
    if (chunkText.trim().length > 20) {
      chunks.push({
        text: chunkText,
        startLine: chunkStartLine + 1,
        endLine: lines.length,
        tokenCount: currentTokenCount
      });
    }
  }

  return chunks;
}
