import { fdir } from "fdir";
import fs from "fs/promises";
import chokidar from "chokidar";
import path from "path";
import os from "os";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { smartChunk, hashContent } from "../lib/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CodebaseIndexer {
  constructor(embedder, cache, config, server = null) {
    this.embedder = embedder;
    this.cache = cache;
    this.config = config;
    this.server = server;
    this.watcher = null;
    this.workers = [];
    this.workerReady = [];
    this.isIndexing = false;

    // Smart Watcher State
    this.changeQueue = new Set();
    this.debounceTimer = null;
    this.firstChangeTimestamp = null;
    this.DEBOUNCE_DELAY = 10000; // 10 seconds quiet period
    this.MAX_WAIT = 60000;       // 60 seconds max wait
  }

  /**
   * Initialize worker thread pool for parallel embedding
   */
  async initializeWorkers() {
    const numWorkers = this.config.workerThreads === "auto"
      ? Math.max(1, os.cpus().length - 1)
      : (this.config.workerThreads || 1);

    // Only use workers if we have more than 1 CPU
    if (numWorkers <= 1) {
      console.error("[Indexer] Single-threaded mode (1 CPU detected)");
      return;
    }

    if (this.config.verbose) {
      console.error(`[Indexer] Worker config: workerThreads=${this.config.workerThreads}, resolved to ${numWorkers}`);
    }

    console.error(`[Indexer] Initializing ${numWorkers} worker threads...`);

    const workerPath = path.join(__dirname, "../lib/embedding-worker.js");

    for (let i = 0; i < numWorkers; i++) {
      try {
        const worker = new Worker(workerPath, {
          workerData: {
            embeddingModel: this.config.embeddingModel,
            verbose: this.config.verbose
          }
        });

        const readyPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Worker init timeout")), 120000);

          worker.once("message", (msg) => {
            clearTimeout(timeout);
            if (msg.type === "ready") {
              resolve(worker);
            } else if (msg.type === "error") {
              reject(new Error(msg.error));
            }
          });

          worker.once("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        this.workers.push(worker);
        this.workerReady.push(readyPromise);
      } catch (err) {
        console.error(`[Indexer] Failed to create worker ${i}: ${err.message}`);
      }
    }

    // Wait for all workers to be ready
    try {
      await Promise.all(this.workerReady);
      console.error(`[Indexer] ${this.workers.length} workers ready`);
      if (this.config.verbose) {
        console.error(`[Indexer] Each worker loaded model: ${this.config.embeddingModel}`);
      }
    } catch (err) {
      console.error(`[Indexer] Worker initialization failed: ${err.message}, falling back to single-threaded`);
      this.terminateWorkers();
    }
  }

  /**
   * Terminate all worker threads
   */
  terminateWorkers() {
    for (const worker of this.workers) {
      worker.postMessage({ type: "shutdown" });
    }
    this.workers = [];
    this.workerReady = [];
  }

  /**
   * Send MCP progress notification to connected clients
   */
  sendProgress(progress, total, message) {
    if (this.server) {
      try {
        this.server.sendNotification("notifications/progress", {
          progressToken: "indexing",
          progress,
          total,
          message
        });
      } catch (err) {
        // Silently ignore if client doesn't support progress notifications
      }
    }
  }

  /**
   * Process chunks using worker thread pool with timeout and error recovery
   */
  async processChunksWithWorkers(allChunks) {
    if (this.workers.length === 0) {
      // Fallback to single-threaded processing
      return this.processChunksSingleThreaded(allChunks);
    }

    const results = [];
    const chunkSize = Math.ceil(allChunks.length / this.workers.length);
    const workerPromises = [];
    const WORKER_TIMEOUT = 300000; // 5 minutes per batch

    if (this.config.verbose) {
      console.error(`[Indexer] Distributing ${allChunks.length} chunks across ${this.workers.length} workers (~${chunkSize} chunks each)`);
    }

    for (let i = 0; i < this.workers.length; i++) {
      const workerChunks = allChunks.slice(i * chunkSize, (i + 1) * chunkSize);
      if (workerChunks.length === 0) continue;

      if (this.config.verbose) {
        console.error(`[Indexer] Worker ${i}: processing ${workerChunks.length} chunks`);
      }

      const promise = new Promise((resolve, reject) => {
        const worker = this.workers[i];
        const batchId = `batch-${i}-${Date.now()}`;

        // Timeout handler
        const timeout = setTimeout(() => {
          worker.off("message", handler);
          console.error(`[Indexer] Worker ${i} timed out, falling back to single-threaded for this batch`);
          // Return empty and let fallback handle it
          resolve([]);
        }, WORKER_TIMEOUT);

        const handler = (msg) => {
          if (msg.batchId === batchId) {
            clearTimeout(timeout);
            worker.off("message", handler);
            if (msg.type === "results") {
              resolve(msg.results);
            } else if (msg.type === "error") {
              console.error(`[Indexer] Worker ${i} error: ${msg.error}`);
              resolve([]); // Return empty, don't reject - let fallback handle
            }
          }
        };

        // Handle worker crash
        const errorHandler = (err) => {
          clearTimeout(timeout);
          worker.off("message", handler);
          console.error(`[Indexer] Worker ${i} crashed: ${err.message}`);
          resolve([]); // Return empty, don't reject
        };
        worker.once("error", errorHandler);

        worker.on("message", handler);
        worker.postMessage({ type: "process", chunks: workerChunks, batchId });
      });

      workerPromises.push({ promise, chunks: workerChunks });
    }

    // Wait for all workers with error recovery
    const workerResults = await Promise.all(workerPromises.map(p => p.promise));

    // Collect results and identify failed chunks that need retry
    const failedChunks = [];
    for (let i = 0; i < workerResults.length; i++) {
      if (workerResults[i].length > 0) {
        results.push(...workerResults[i]);
      } else if (workerPromises[i].chunks.length > 0) {
        // Worker failed or timed out, need to retry these chunks
        failedChunks.push(...workerPromises[i].chunks);
      }
    }

    // Retry failed chunks with single-threaded fallback
    if (failedChunks.length > 0) {
      console.error(`[Indexer] Retrying ${failedChunks.length} chunks with single-threaded fallback...`);
      const retryResults = await this.processChunksSingleThreaded(failedChunks);
      results.push(...retryResults);
    }

    return results;
  }

  /**
   * Single-threaded chunk processing (fallback)
   */
  async processChunksSingleThreaded(chunks) {
    const results = [];

    for (const chunk of chunks) {
      try {
        const output = await this.embedder(chunk.text, { pooling: "mean", normalize: true });
        results.push({
          file: chunk.file,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.text,
          vector: Array.from(output.data),
          success: true
        });
      } catch (error) {
        results.push({
          file: chunk.file,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          error: error.message,
          success: false
        });
      }
    }

    return results;
  }

  async indexFile(file) {
    const fileName = path.basename(file);
    if (this.config.verbose) {
      console.error(`[Indexer] Processing: ${fileName}...`);
    }

    try {
      // Check file size first
      const stats = await fs.stat(file);

      // Skip directories
      if (stats.isDirectory()) {
        return 0;
      }

      if (stats.size > this.config.maxFileSize) {
        if (this.config.verbose) {
          console.error(`[Indexer] Skipped ${fileName} (too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        }
        return 0;
      }

      const content = await fs.readFile(file, "utf-8");
      const hash = hashContent(content);

      // Skip if file hasn't changed
      if (this.cache.getFileHash(file) === hash) {
        if (this.config.verbose) {
          console.error(`[Indexer] Skipped ${fileName} (unchanged)`);
        }
        return 0;
      }

      if (this.config.verbose) {
        console.error(`[Indexer] Indexing ${fileName}...`);
      }

      // Remove old chunks for this file
      this.cache.removeFileFromStore(file);

      const chunks = smartChunk(content, file, this.config);
      let addedChunks = 0;

      for (const chunk of chunks) {
        try {
          const output = await this.embedder(chunk.text, { pooling: "mean", normalize: true });

          this.cache.addToStore({
            file,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.text,
            vector: Array.from(output.data)
          });
          addedChunks++;
        } catch (embeddingError) {
          console.error(`[Indexer] Failed to embed chunk in ${fileName}:`, embeddingError.message);
        }
      }

      this.cache.setFileHash(file, hash);
      if (this.config.verbose) {
        console.error(`[Indexer] Completed ${fileName} (${addedChunks} chunks)`);
      }
      return addedChunks;
    } catch (error) {
      console.error(`[Indexer] Error indexing ${fileName}:`, error.message);
      return 0;
    }
  }

  /**
   * Discover files using fdir (3-5x faster than glob)
   * Uses config.excludePatterns which includes smart patterns from ignore-patterns.js
   */
  async discoverFiles() {
    const startTime = Date.now();

    // Build extension filter from config
    const extensions = new Set(this.config.fileExtensions.map(ext => `.${ext}`));

    // Extract directory names from glob patterns in config.excludePatterns
    // Patterns like "**/node_modules/**" -> "node_modules"
    const excludeDirs = new Set();
    for (const pattern of this.config.excludePatterns) {
      // Extract directory names from glob patterns
      const match = pattern.match(/\*\*\/([^/*]+)\/?\*?\*?$/);
      if (match) {
        excludeDirs.add(match[1]);
      }
      // Also handle patterns like "**/dirname/**"
      const match2 = pattern.match(/\*\*\/([^/*]+)\/\*\*$/);
      if (match2) {
        excludeDirs.add(match2[1]);
      }
    }

    // Always exclude cache directory
    excludeDirs.add(".smart-coding-cache");

    if (this.config.verbose) {
      console.error(`[Indexer] Using ${excludeDirs.size} exclude directories from config`);
    }

    const api = new fdir()
      .withFullPaths()
      .exclude((dirName) => excludeDirs.has(dirName))
      .filter((filePath) => extensions.has(path.extname(filePath)))
      .crawl(this.config.searchDirectory);

    const files = await api.withPromise();

    console.error(`[Indexer] File discovery: ${files.length} files in ${Date.now() - startTime}ms`);
    return files;
  }

  /**
   * Pre-filter files by hash (skip unchanged files before processing)
   */
  async preFilterFiles(files) {
    const startTime = Date.now();
    const filesToProcess = [];
    const skippedCount = { unchanged: 0, tooLarge: 0, error: 0 };

    // Process in parallel batches for speed
    const BATCH_SIZE = 500;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (file) => {
          try {
            const stats = await fs.stat(file);

            if (stats.isDirectory()) {
              return null;
            }

            if (stats.size > this.config.maxFileSize) {
              skippedCount.tooLarge++;
              return null;
            }

            const content = await fs.readFile(file, "utf-8");
            const hash = hashContent(content);

            if (this.cache.getFileHash(file) === hash) {
              skippedCount.unchanged++;
              return null;
            }

            return { file, content, hash };
          } catch (error) {
            skippedCount.error++;
            return null;
          }
        })
      );

      for (const result of results) {
        if (result) filesToProcess.push(result);
      }
    }

    console.error(`[Indexer] Pre-filter: ${filesToProcess.length} changed, ${skippedCount.unchanged} unchanged, ${skippedCount.tooLarge} too large, ${skippedCount.error} errors (${Date.now() - startTime}ms)`);
    return filesToProcess;
  }

  async indexAll(force = false) {
    if (this.isIndexing) {
      console.error("[Indexer] Indexing already in progress, skipping concurrent request");
      return { skipped: true, reason: "Indexing already in progress" };
    }

    this.isIndexing = true;

    try {
      if (force) {
        console.error("[Indexer] Force reindex requested: clearing cache");
        this.cache.setVectorStore([]);
        this.cache.fileHashes = new Map();
      }

      const totalStartTime = Date.now();
      console.error(`[Indexer] Starting optimized indexing in ${this.config.searchDirectory}...`);

      // Step 1: Fast file discovery with fdir
      console.error(`\n=== SMART CODING MCP: STARTING INDEXING ===`);
      console.error(`[Indexer] Target Directory: ${this.config.searchDirectory}`);

      // Step 1: Fast file discovery with fdir
      const files = await this.discoverFiles();

      if (files.length === 0) {
        console.error("[Indexer] No files found to index");
        this.sendProgress(100, 100, "No files found to index");
        return { skipped: false, filesProcessed: 0, chunksCreated: 0, message: "No files found to index" };
      }

      // Send progress: discovery complete
      this.sendProgress(5, 100, `Discovered ${files.length} files`);

      // Step 1.5: Prune deleted or excluded files from cache
      if (!force) {
        const currentFilesSet = new Set(files);
        const cachedFiles = Array.from(this.cache.fileHashes.keys());
        let prunedCount = 0;

        for (const cachedFile of cachedFiles) {
          if (!currentFilesSet.has(cachedFile)) {
            this.cache.removeFileFromStore(cachedFile);
            this.cache.deleteFileHash(cachedFile);
            prunedCount++;
          }
        }

        if (prunedCount > 0) {
          if (this.config.verbose) {
            console.error(`[Indexer] Pruned ${prunedCount} deleted/excluded files from index`);
          }
          // If we pruned files, we should save these changes even if no other files changed
        }
      }

      // Step 2: Pre-filter unchanged files (early hash check)
      const filesToProcess = await this.preFilterFiles(files);

      if (filesToProcess.length === 0) {
        console.error("[Indexer] All files unchanged, nothing to index");
        this.sendProgress(100, 100, "All files up to date");
        await this.cache.save();
        const vectorStore = this.cache.getVectorStore();
        return {
          skipped: false,
          filesProcessed: 0,
          chunksCreated: 0,
          totalFiles: new Set(vectorStore.map(v => v.file)).size,
          totalChunks: vectorStore.length,
          message: "All files up to date"
        };
      }

      // Send progress: filtering complete
      this.sendProgress(10, 100, `Processing ${filesToProcess.length} changed files`);

      // Step 3: Determine batch size based on project size
      const adaptiveBatchSize = files.length > 10000 ? 500 :
        files.length > 1000 ? 200 :
          this.config.batchSize || 100;

      console.error(`[Indexer] Processing ${filesToProcess.length} files (batch size: ${adaptiveBatchSize})`);

      // Step 4: Initialize worker threads (always use when multi-core available)
      const useWorkers = os.cpus().length > 1;

      if (useWorkers) {
        await this.initializeWorkers();
        console.error(`[Indexer] Multi-threaded mode: ${this.workers.length} workers active`);
      } else {
        console.error(`[Indexer] Single-threaded mode (single-core system)`);
      }

      let totalChunks = 0;
      let processedFiles = 0;

      // Step 5: Process files in adaptive batches
      for (let i = 0; i < filesToProcess.length; i += adaptiveBatchSize) {
        const batch = filesToProcess.slice(i, i + adaptiveBatchSize);

        // Generate all chunks for this batch
        const allChunks = [];

        for (const { file, content, hash } of batch) {
          // Remove old chunks for this file
          this.cache.removeFileFromStore(file);

          const chunks = smartChunk(content, file, this.config);

          for (const chunk of chunks) {
            allChunks.push({
              file,
              text: chunk.text,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              hash
            });
          }
        }

        // Process chunks (with workers if available, otherwise single-threaded)
        let results;
        if (useWorkers && this.workers.length > 0) {
          results = await this.processChunksWithWorkers(allChunks);
        } else {
          results = await this.processChunksSingleThreaded(allChunks);
        }

        // Store successful results
        const fileHashes = new Map();
        for (const result of results) {
          if (result.success) {
            this.cache.addToStore({
              file: result.file,
              startLine: result.startLine,
              endLine: result.endLine,
              content: result.content,
              vector: result.vector
            });
            totalChunks++;
          }
          // Track hash for each file
          const chunkInfo = allChunks.find(c => c.file === result.file);
          if (chunkInfo) {
            fileHashes.set(result.file, chunkInfo.hash);
          }
        }

        // Update file hashes
        for (const [file, hash] of fileHashes) {
          this.cache.setFileHash(file, hash);
        }

        processedFiles += batch.length;

        // Progress indicator every batch
        if (processedFiles % (adaptiveBatchSize * 2) === 0 || processedFiles === filesToProcess.length) {
          const elapsed = ((Date.now() - totalStartTime) / 1000).toFixed(1);
          const rate = (processedFiles / parseFloat(elapsed)).toFixed(0);
          console.error(`[Indexer] Progress: ${processedFiles}/${filesToProcess.length} files (${rate} files/sec)`);

          // Send MCP progress notification (10-95% range for batch processing)
          const progressPercent = Math.floor(10 + (processedFiles / filesToProcess.length) * 85);
          this.sendProgress(progressPercent, 100, `Indexed ${processedFiles}/${filesToProcess.length} files (${rate}/sec)`);
        }
      }

      // Cleanup workers
      if (useWorkers) {
        this.terminateWorkers();
      }

      const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(1);
      console.error(`[Indexer] Complete: ${totalChunks} chunks from ${filesToProcess.length} files in ${totalTime}s`);

      // Send completion progress
      this.sendProgress(100, 100, `Complete: ${totalChunks} chunks from ${filesToProcess.length} files in ${totalTime}s`);

      console.error(`=== SMART CODING MCP: INDEXING COMPLETE ===`);
      console.error(`[Indexer] Processed ${filesToProcess.length} files in ${totalTime}s`);
      console.error(`[Indexer] You can now search your codebase!`);
      console.error(`============================================\n`);

      await this.cache.save();

      const vectorStore = this.cache.getVectorStore();
      return {
        skipped: false,
        filesProcessed: filesToProcess.length,
        chunksCreated: totalChunks,
        totalFiles: new Set(vectorStore.map(v => v.file)).size,
        totalChunks: vectorStore.length,
        duration: totalTime,
        message: `Indexed ${filesToProcess.length} files (${totalChunks} chunks) in ${totalTime}s`
      };
    } finally {
      this.isIndexing = false;
    }
  }

  async processChangeQueue() {
    if (this.changeQueue.size === 0) return;

    if (this.isIndexing) {
      console.error("[Watcher] Indexing in progress, deferring change queue processing");
      // Re-schedule after a delay
      this.debounceTimer = setTimeout(() => this.processChangeQueue(), this.DEBOUNCE_DELAY);
      return;
    }

    this.isIndexing = true;
    try {
      // Reset timers
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.firstChangeTimestamp = null;

      const filesToProcess = Array.from(this.changeQueue);
      this.changeQueue.clear();

      console.error(`\n=== SMART CODING MCP: PROCESS PENDING CHANGES ===`);
      console.error(`[Watcher] Processing ${filesToProcess.length} pending file changes...`);

      let processedCount = 0;
      for (const file of filesToProcess) {
        // Check if file still exists (it might have been deleted while queued)
        try {
          await fs.access(file);
          const chunks = await this.indexFile(file);
          if (chunks > 0) processedCount++;
        } catch {
          // File deleted, remove from index
          this.cache.removeFileFromStore(file);
          this.cache.deleteFileHash(file);
        }
      }

      await this.cache.save();
      console.error(`[Watcher] Updated ${processedCount} files in index`);
      console.error(`=================================================\n`);
    } finally {
      this.isIndexing = false;
    }
  }

  queueFileChange(filePath) {
    const fullPath = path.join(this.config.searchDirectory, filePath);
    this.changeQueue.add(fullPath);

    // Initialize max wait timer if this is the first change in the batch
    if (!this.firstChangeTimestamp) {
      this.firstChangeTimestamp = Date.now();
    }

    // Check if we've waited too long (Max Wait)
    if (Date.now() - this.firstChangeTimestamp > this.MAX_WAIT) {
      console.error(`[Watcher] Max wait time reached (${this.MAX_WAIT}ms), forcing update...`);
      // Don't await - let it run in background, but the guard will prevent races
      this.processChangeQueue();
      return;
    }

    // Reset Debounce Timer (Wait for silence)
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    console.error(`[Watcher] Change detected: ${path.basename(filePath)} (queued, waiting for ${this.DEBOUNCE_DELAY / 1000}s silence)`);

    this.debounceTimer = setTimeout(() => {
      this.processChangeQueue();
    }, this.DEBOUNCE_DELAY);
  }

  setupFileWatcher() {
    if (!this.config.watchFiles) return;

    const pattern = this.config.fileExtensions.map(ext => `**/*.${ext}`);

    this.watcher = chokidar.watch(pattern, {
      cwd: this.config.searchDirectory,
      ignored: this.config.excludePatterns,
      persistent: true,
      ignoreInitial: true
    });

    this.watcher
      .on("add", (filePath) => this.queueFileChange(filePath))
      .on("change", (filePath) => this.queueFileChange(filePath))
      .on("unlink", (filePath) => {
        const fullPath = path.join(this.config.searchDirectory, filePath);
        console.error(`[Watcher] File deleted: ${filePath} (removing immediately)`);
        this.cache.removeFileFromStore(fullPath);
        this.cache.deleteFileHash(fullPath);
        this.cache.save();
        // Also remove from queue if it was pending
        this.changeQueue.delete(fullPath);
      });

    console.error(`[Watcher] Smart Watcher enabled (Lazy Update Mode - ${this.DEBOUNCE_DELAY / 1000}s debounce)`);
  }
}

// MCP Tool definition for this feature
export function getToolDefinition() {
  return {
    name: "b_index_codebase",
    description: "Manually trigger a full reindex of the codebase. This will scan all files and update the embeddings cache. Useful after large code changes or if the index seems out of date.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Force reindex even if files haven't changed",
          default: false
        }
      }
    },
    annotations: {
      title: "Reindex Codebase",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  };
}

// Tool handler
export async function handleToolCall(request, indexer) {
  const force = request.params.arguments?.force || false;
  const result = await indexer.indexAll(force);

  // Handle case when indexing was skipped due to concurrent request
  if (result?.skipped) {
    return {
      content: [{
        type: "text",
        text: `Indexing skipped: ${result.reason}\n\nPlease wait for the current indexing operation to complete before requesting another reindex.`
      }]
    };
  }

  // Get current stats from cache
  const vectorStore = indexer.cache.getVectorStore();
  const stats = {
    totalChunks: result?.totalChunks ?? vectorStore.length,
    totalFiles: result?.totalFiles ?? new Set(vectorStore.map(v => v.file)).size,
    filesProcessed: result?.filesProcessed ?? 0,
    chunksCreated: result?.chunksCreated ?? 0
  };

  let message = result?.message
    ? `Codebase reindexed successfully.\n\n${result.message}`
    : `Codebase reindexed successfully.`;

  message += `\n\nStatistics:\n- Total files in index: ${stats.totalFiles}\n- Total code chunks: ${stats.totalChunks}`;

  if (stats.filesProcessed > 0) {
    message += `\n- Files processed this run: ${stats.filesProcessed}\n- Chunks created this run: ${stats.chunksCreated}`;
  }

  return {
    content: [{
      type: "text",
      text: message
    }]
  };
}
