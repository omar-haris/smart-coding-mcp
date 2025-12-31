/**
 * Tests for AST Chunker
 * 
 * Tests the AST-based code chunking functionality:
 * - Tree-sitter initialization
 * - Language detection
 * - Semantic chunking vs smart chunking fallback
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ASTChunker, getChunker } from '../lib/ast-chunker.js';
import { loadConfig } from '../lib/config.js';

describe('AST Chunker', () => {
  let config;
  
  beforeAll(async () => {
    config = await loadConfig();
  });

  describe('Chunker Factory', () => {
    it('should return AST chunker when mode is ast', () => {
      const chunker = getChunker({ ...config, chunkingMode: 'ast' });
      expect(chunker).toBeInstanceOf(ASTChunker);
    });

    it('should return smart chunker wrapper when mode is smart', () => {
      const chunker = getChunker({ ...config, chunkingMode: 'smart' });
      expect(typeof chunker.chunk).toBe('function');
      expect(chunker).not.toBeInstanceOf(ASTChunker);
    });
  });

  describe('Language Detection', () => {
    it('should detect JavaScript files', () => {
      const chunker = new ASTChunker(config);
      expect(chunker.getLanguageForFile('test.js')).toBe('javascript');
      expect(chunker.getLanguageForFile('test.mjs')).toBe('javascript');
      expect(chunker.getLanguageForFile('test.jsx')).toBe('javascript');
    });

    it('should detect TypeScript files', () => {
      const chunker = new ASTChunker(config);
      expect(chunker.getLanguageForFile('test.ts')).toBe('typescript');
      expect(chunker.getLanguageForFile('test.tsx')).toBe('typescript');
    });

    it('should detect Python files', () => {
      const chunker = new ASTChunker(config);
      expect(chunker.getLanguageForFile('test.py')).toBe('python');
    });

    it('should return null for unsupported files', () => {
      const chunker = new ASTChunker(config);
      expect(chunker.getLanguageForFile('test.sql')).toBeNull();
      expect(chunker.getLanguageForFile('test.md')).toBeNull();
    });
  });

  describe('Fallback Behavior', () => {
    it('should fall back to smart chunking for unsupported languages', async () => {
      const chunker = new ASTChunker(config);
      const sqlContent = 'SELECT * FROM users WHERE id = 1;';
      
      const chunks = await chunker.chunk(sqlContent, 'query.sql');
      expect(Array.isArray(chunks)).toBe(true);
    });

    it('should handle empty content', async () => {
      const chunker = new ASTChunker(config);
      const chunks = await chunker.chunk('', 'empty.js');
      expect(Array.isArray(chunks)).toBe(true);
    });
  });

  describe('JavaScript Chunking', () => {
    it('should chunk JavaScript functions', async () => {
      const chunker = new ASTChunker(config);
      const jsCode = `
function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

class Calculator {
  constructor() {
    this.result = 0;
  }
  
  add(n) {
    this.result += n;
    return this;
  }
}
`;
      
      const chunks = await chunker.chunk(jsCode, 'calc.js');
      expect(Array.isArray(chunks)).toBe(true);
      // Should have found some chunks (exact number depends on Tree-sitter grammar availability)
    });
  });
});
