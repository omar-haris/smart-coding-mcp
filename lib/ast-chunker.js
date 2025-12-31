/**
 * AST-based Code Chunker
 * 
 * Uses Tree-sitter to parse code and chunk at semantic boundaries
 * (functions, classes, methods) instead of arbitrary line splits.
 */

import Parser from 'web-tree-sitter';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { smartChunk } from './utils.js'; // Fallback

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mapping of file extensions to Tree-sitter language names
const LANGUAGE_MAP = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp'
};

// Node types that represent semantic boundaries
const SEMANTIC_NODES = {
  javascript: ['function_declaration', 'arrow_function', 'class_declaration', 'method_definition', 'export_statement'],
  typescript: ['function_declaration', 'arrow_function', 'class_declaration', 'method_definition', 'export_statement'],
  python: ['function_definition', 'class_definition', 'decorated_definition'],
  go: ['function_declaration', 'method_declaration', 'type_declaration'],
  rust: ['function_item', 'impl_item', 'struct_item', 'enum_item'],
  ruby: ['method', 'class', 'module'],
  java: ['method_declaration', 'class_declaration', 'interface_declaration'],
  c: ['function_definition', 'struct_specifier'],
  cpp: ['function_definition', 'class_specifier', 'struct_specifier']
};

export class ASTChunker {
  constructor(config) {
    this.config = config;
    this.parser = null;
    this.languages = new Map();
    this.initialized = false;
  }

  /**
   * Initialize Tree-sitter parser
   */
  async init() {
    if (this.initialized) return;
    
    try {
      await Parser.init();
      this.parser = new Parser();
      this.initialized = true;
      console.error('[AST] Tree-sitter parser initialized');
    } catch (error) {
      console.error('[AST] Failed to initialize Tree-sitter:', error.message);
      throw error;
    }
  }

  /**
   * Load a language grammar
   */
  async loadLanguage(langName) {
    if (this.languages.has(langName)) {
      return this.languages.get(langName);
    }

    try {
      // Try to find the WASM file in node_modules
      const possiblePaths = [
        path.join(__dirname, '..', 'node_modules', `tree-sitter-${langName}`, `tree-sitter-${langName}.wasm`),
        path.join(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${langName}.wasm`),
        path.join(__dirname, '..', 'grammars', `tree-sitter-${langName}.wasm`)
      ];

      for (const wasmPath of possiblePaths) {
        try {
          await fs.access(wasmPath);
          const language = await Parser.Language.load(wasmPath);
          this.languages.set(langName, language);
          if (this.config.verbose) {
            console.error(`[AST] Loaded ${langName} grammar from ${wasmPath}`);
          }
          return language;
        } catch {
          continue;
        }
      }

      console.error(`[AST] No grammar found for ${langName}`);
      return null;
    } catch (error) {
      console.error(`[AST] Failed to load ${langName}:`, error.message);
      return null;
    }
  }

  /**
   * Get the language name from file extension
   */
  getLanguageForFile(file) {
    const ext = path.extname(file).slice(1).toLowerCase();
    return LANGUAGE_MAP[ext] || null;
  }

  /**
   * Chunk code using AST analysis
   */
  async chunk(content, file) {
    // Initialize if needed
    if (!this.initialized) {
      await this.init();
    }

    const langName = this.getLanguageForFile(file);
    
    // Fall back to smart chunking if language not supported
    if (!langName) {
      if (this.config.verbose) {
        console.error(`[AST] No AST support for ${path.extname(file)}, using smart chunking`);
      }
      return smartChunk(content, file, this.config);
    }

    const language = await this.loadLanguage(langName);
    
    // Fall back if grammar not available
    if (!language) {
      return smartChunk(content, file, this.config);
    }

    try {
      this.parser.setLanguage(language);
      const tree = this.parser.parse(content);
      const chunks = [];
      const lines = content.split('\n');
      const semanticNodes = SEMANTIC_NODES[langName] || [];

      // Walk the AST and extract semantic chunks
      this.walkTree(tree.rootNode, (node) => {
        if (semanticNodes.includes(node.type)) {
          const startLine = node.startPosition.row;
          const endLine = node.endPosition.row;
          
          // Skip very small nodes (< 3 lines)
          if (endLine - startLine < 2) return;
          
          // Extract the text for this node
          const chunkLines = lines.slice(startLine, endLine + 1);
          const text = chunkLines.join('\n');
          
          // Skip if too large (will be handled by split)
          const targetTokens = this.config.chunkSize * 4; // Rough estimate
          if (text.length > targetTokens * 4) {
            // Split large nodes
            this.splitLargeNode(node, lines, chunks);
          } else {
            chunks.push({
              text,
              startLine: startLine + 1, // 1-indexed
              endLine: endLine + 1,
              nodeType: node.type
            });
          }
        }
      });

      // If no semantic chunks found, fall back to smart chunking
      if (chunks.length === 0) {
        return smartChunk(content, file, this.config);
      }

      // Sort by start line
      chunks.sort((a, b) => a.startLine - b.startLine);

      // Merge small gaps and remove overlaps
      return this.mergeAndCleanChunks(chunks, lines);

    } catch (error) {
      console.error(`[AST] Parse error for ${file}:`, error.message);
      return smartChunk(content, file, this.config);
    }
  }

  /**
   * Walk the AST tree and call callback for each node
   */
  walkTree(node, callback) {
    callback(node);
    for (let i = 0; i < node.childCount; i++) {
      this.walkTree(node.child(i), callback);
    }
  }

  /**
   * Split large AST nodes into smaller chunks
   */
  splitLargeNode(node, lines, chunks) {
    const chunkSize = this.config.chunkSize || 25;
    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row;
    
    for (let i = startLine; i <= endLine; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize - 1, endLine);
      const chunkLines = lines.slice(i, chunkEnd + 1);
      
      chunks.push({
        text: chunkLines.join('\n'),
        startLine: i + 1,
        endLine: chunkEnd + 1,
        nodeType: node.type + '_part'
      });
    }
  }

  /**
   * Merge small chunks and clean up overlaps
   */
  mergeAndCleanChunks(chunks, lines) {
    const cleaned = [];
    const minSize = 5; // Minimum lines per chunk

    for (const chunk of chunks) {
      // Skip if overlaps with previous
      if (cleaned.length > 0) {
        const prev = cleaned[cleaned.length - 1];
        if (chunk.startLine <= prev.endLine) {
          // Extend previous chunk if this one extends further
          if (chunk.endLine > prev.endLine) {
            prev.endLine = chunk.endLine;
            const extendedLines = lines.slice(prev.startLine - 1, prev.endLine);
            prev.text = extendedLines.join('\n');
          }
          continue;
        }
      }

      // Add to cleaned list
      cleaned.push(chunk);
    }

    return cleaned;
  }
}

/**
 * Factory function to get the appropriate chunker based on config
 */
export function getChunker(config) {
  if (config.chunkingMode === 'ast') {
    return new ASTChunker(config);
  }
  
  // Return a wrapper that uses smartChunk
  return {
    async chunk(content, file) {
      return smartChunk(content, file, config);
    }
  };
}
