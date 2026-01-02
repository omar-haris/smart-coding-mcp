import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';

/**
 * SQLite-based embeddings cache for fast, efficient storage
 * Replaces JSON-based cache for better performance on large codebases
 */
export class SQLiteCache {
  constructor(config) {
    this.config = config;
    this.db = null;
    this.isSaving = false;
    this.dbPath = path.join(config.cacheDirectory, 'embeddings.db');
    
    // Track indexing status for progressive indexing
    this.indexingStatus = {
      inProgress: false,
      totalFiles: 0,
      processedFiles: 0,
      percentage: 0
    };
  }

  /**
   * Initialize SQLite database and create schema
   */
  async load() {
    if (!this.config.enableCache) return;
    
    try {
      // Ensure cache directory exists
      await fs.mkdir(this.config.cacheDirectory, { recursive: true });
      
      // Check if we need to migrate from JSON
      const jsonCacheExists = await this.checkJSONCache();
      
      // Open SQLite database
      this.db = new Database(this.dbPath);
      
      // Enable performance optimizations
      this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
      this.db.pragma('synchronous = NORMAL'); // Faster writes, still safe
      this.db.pragma('cache_size = 10000'); // 10MB cache
      this.db.pragma('temp_store = MEMORY'); // Temp tables in memory
      
      // Create schema if not exists
      this.createSchema();
      
      // Migrate from JSON if needed
      if (jsonCacheExists && this.getVectorCount() === 0) {
        console.error('[Cache] Migrating from JSON to SQLite...');
        await this.migrateFromJSON();
      }
      
      const count = this.getVectorCount();
      const fileCount = this.getFileCount();
      console.error(`[Cache] Loaded SQLite cache: ${count} embeddings from ${fileCount} files`);
    } catch (error) {
      console.error('[Cache] Failed to initialize SQLite cache:', error.message);
      throw error;
    }
  }

  /**
   * Create database schema
   */
  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        vector BLOB NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_hashes (
        file TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_file ON embeddings(file);
      CREATE INDEX IF NOT EXISTS idx_indexed_at ON embeddings(indexed_at);
    `);
  }

  /**
   * Check if JSON cache exists
   */
  async checkJSONCache() {
    try {
      const jsonPath = path.join(this.config.cacheDirectory, 'embeddings.json');
      await fs.access(jsonPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Migrate from JSON cache to SQLite
   */
  async migrateFromJSON() {
    try {
      const jsonCachePath = path.join(this.config.cacheDirectory, 'embeddings.json');
      const jsonHashPath = path.join(this.config.cacheDirectory, 'file-hashes.json');
      
      const [cacheData, hashData] = await Promise.all([
        fs.readFile(jsonCachePath, 'utf-8').catch(() => null),
        fs.readFile(jsonHashPath, 'utf-8').catch(() => null)
      ]);

      if (!cacheData || !hashData) {
        console.error('[Cache] No JSON cache found to migrate');
        return;
      }

      const vectorStore = JSON.parse(cacheData);
      const fileHashes = new Map(Object.entries(JSON.parse(hashData)));

      console.error(`[Cache] Migrating ${vectorStore.length} embeddings...`);

      // Use transaction for fast batch insert
      const insertVector = this.db.prepare(`
        INSERT INTO embeddings (file, start_line, end_line, content, vector, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const insertHash = this.db.prepare(`
        INSERT OR REPLACE INTO file_hashes (file, hash, indexed_at)
        VALUES (?, ?, ?)
      `);

      const transaction = this.db.transaction(() => {
        const now = Date.now();
        
        for (const chunk of vectorStore) {
          const vectorBuffer = this.vectorToBuffer(chunk.vector);
          insertVector.run(
            chunk.file,
            chunk.startLine,
            chunk.endLine,
            chunk.content,
            vectorBuffer,
            now
          );
        }

        for (const [file, hash] of fileHashes) {
          insertHash.run(file, hash, now);
        }
      });

      transaction();

      console.error('[Cache] Migration complete! Backing up JSON files...');
      
      // Backup old JSON files
      await fs.rename(jsonCachePath, jsonCachePath + '.backup');
      await fs.rename(jsonHashPath, jsonHashPath + '.backup');
      
      console.error('[Cache] JSON cache backed up (you can delete .backup files if everything works)');
    } catch (error) {
      console.error('[Cache] Migration failed:', error.message);
      throw error;
    }
  }

  /**
   * Convert Float32Array/Array to Buffer for SQLite storage
   */
  vectorToBuffer(vector) {
    const float32 = new Float32Array(vector);
    return Buffer.from(float32.buffer);
  }

  /**
   * Convert Buffer back to Array for compatibility
   */
  bufferToVector(buffer) {
    const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
    return Array.from(float32);
  }

  /**
   * Get all vectors from store (lazy loaded)
   */
  getVectorStore() {
    if (!this.db) return [];
    
    const stmt = this.db.prepare(`
      SELECT file, start_line, end_line, content, vector
      FROM embeddings
      ORDER BY file, start_line
    `);

    const rows = stmt.all();
    return rows.map(row => ({
      file: row.file,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      vector: this.bufferToVector(row.vector)
    }));
  }

  /**
   * Get vector count
   */
  getVectorCount() {
    if (!this.db) return 0;
    const result = this.db.prepare('SELECT COUNT(*) as count FROM embeddings').get();
    return result.count;
  }

  /**
   * Get unique file count
   */
  getFileCount() {
    if (!this.db) return 0;
    const result = this.db.prepare('SELECT COUNT(DISTINCT file) as count FROM embeddings').get();
    return result.count;
  }

  /**
   * Add chunk to store with batch optimization
   */
  addToStore(chunk) {
    if (!this.db) return;
    
    const vectorBuffer = this.vectorToBuffer(chunk.vector);
    const stmt = this.db.prepare(`
      INSERT INTO embeddings (file, start_line, end_line, content, vector, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      chunk.file,
      chunk.startLine,
      chunk.endLine,
      chunk.content,
      vectorBuffer,
      Date.now()
    );
  }

  /**
   * Add multiple chunks in a transaction (much faster)
   */
  addBatchToStore(chunks) {
    if (!this.db || chunks.length === 0) return;
    
    const stmt = this.db.prepare(`
      INSERT INTO embeddings (file, start_line, end_line, content, vector, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      const now = Date.now();
      for (const chunk of chunks) {
        const vectorBuffer = this.vectorToBuffer(chunk.vector);
        stmt.run(
          chunk.file,
          chunk.startLine,
          chunk.endLine,
          chunk.content,
          vectorBuffer,
          now
        );
      }
    });

    transaction();
  }

  /**
   * Remove all chunks for a specific file
   */
  removeFileFromStore(file) {
    if (!this.db) return;
    
    const stmt = this.db.prepare('DELETE FROM embeddings WHERE file = ?');
    stmt.run(file);
  }

  /**
   * Get file hash
   */
  getFileHash(file) {
    if (!this.db) return null;
    
    const stmt = this.db.prepare('SELECT hash FROM file_hashes WHERE file = ?');
    const row = stmt.get(file);
    return row ? row.hash : null;
  }

  /**
   * Set file hash
   */
  setFileHash(file, hash) {
    if (!this.db) return;
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO file_hashes (file, hash, indexed_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(file, hash, Date.now());
  }

  /**
   * Delete file hash
   */
  deleteFileHash(file) {
    if (!this.db) return;
    
    const stmt = this.db.prepare('DELETE FROM file_hashes WHERE file = ?');
    stmt.run(file);
  }

  /**
   * Get all file hashes as Map
   */
  getAllFileHashes() {
    if (!this.db) return new Map();
    
    const stmt = this.db.prepare('SELECT file, hash FROM file_hashes');
    const rows = stmt.all();
    return new Map(rows.map(row => [row.file, row.hash]));
  }

  /**
   * Save (checkpoint WAL for durability)
   * With SQLite, writes are already persisted, this just checkpoints the WAL
   */
  async save() {
    if (!this.config.enableCache || !this.db) return;
    
    this.isSaving = true;
    
    try {
      // Checkpoint WAL to ensure durability
      this.db.pragma('wal_checkpoint(PASSIVE)');
    } catch (error) {
      console.error('[Cache] Failed to checkpoint WAL:', error.message);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Incremental save during indexing (no-op for SQLite, already persisted)
   */
  async saveIncremental() {
    // SQLite writes are already persisted due to WAL mode
    // This is a no-op but kept for API compatibility
    return;
  }

  /**
   * Clear all cache data
   */
  async clear() {
    if (!this.config.enableCache) return;
    
    try {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      
      await fs.rm(this.config.cacheDirectory, { recursive: true, force: true });
      console.error(`[Cache] Cache cleared successfully: ${this.config.cacheDirectory}`);
    } catch (error) {
      console.error('[Cache] Failed to clear cache:', error.message);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Set vector store (for compatibility with test code)
   * This is less efficient than batch operations but kept for compatibility
   */
  setVectorStore(store) {
    if (!this.db) return;
    
    // Clear existing data
    this.db.exec('DELETE FROM embeddings');
    
    // Insert new data
    if (store.length > 0) {
      this.addBatchToStore(store);
    }
  }
}
