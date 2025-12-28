import { parentPort, workerData } from "worker_threads";
import { pipeline } from "@xenova/transformers";

let embedder = null;

// Initialize the embedding model once when worker starts
async function initializeEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", workerData.embeddingModel);
  }
  return embedder;
}

/**
 * Process chunks with optimized single-text embedding
 * Note: Batch processing with transformers.js WASM backend doesn't improve speed
 * because it loops internally. Single calls are actually faster.
 */
async function processChunks(chunks) {
  const embedder = await initializeEmbedder();
  const results = [];

  for (const chunk of chunks) {
    try {
      const output = await embedder(chunk.text, { pooling: "mean", normalize: true });
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

// Listen for messages from main thread
parentPort.on("message", async (message) => {
  if (message.type === "process") {
    try {
      const results = await processChunks(message.chunks);
      parentPort.postMessage({ type: "results", results, batchId: message.batchId });
    } catch (error) {
      parentPort.postMessage({ type: "error", error: error.message, batchId: message.batchId });
    }
  } else if (message.type === "shutdown") {
    process.exit(0);
  }
});

// Signal that worker is ready
initializeEmbedder().then(() => {
  parentPort.postMessage({ type: "ready" });
}).catch((error) => {
  parentPort.postMessage({ type: "error", error: error.message });
});
