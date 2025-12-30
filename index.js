#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// ... imports
import { CallToolRequestSchema, ListToolsRequestSchema, InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pipeline } from "@xenova/transformers";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";

// Import package.json for version
const require = createRequire(import.meta.url);
const packageJson = require("./package.json");

import { loadConfig } from "./lib/config.js";
import { configureAntigravity } from "./lib/ide-setup.js";
import { EmbeddingsCache } from "./lib/cache.js";
import { CodebaseIndexer } from "./features/index-codebase.js";
import { HybridSearch } from "./features/hybrid-search.js";

import * as IndexCodebaseFeature from "./features/index-codebase.js";
import * as HybridSearchFeature from "./features/hybrid-search.js";
import * as ClearCacheFeature from "./features/clear-cache.js";
import * as ConfigureFeature from "./features/configure.js";

// Parse arguments
const args = process.argv.slice(2);

// Handle help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Smart Coding MCP v${packageJson.version}
Usage: npx smart-coding-mcp [options]

Options:
  --workspace <path>    Set the active workspace directory (default: current directory)
  --configure           Automatically update Antigravity configuration for current directory
  --help, -h            Show this help message

Environment Variables:
  SMART_CODING_VERBOSE=true          Enable verbose logging
  SMART_CODING_WATCH_FILES=true      Enable file watching
  `);
  process.exit(0);
}

// Handle Configuration Mode
if (args.includes('--configure') || args.includes('--setup')) {
  configureAntigravity();
  process.exit(0);
}

const workspaceIndex = args.findIndex(arg => arg.startsWith('--workspace'));
let workspaceDir = process.cwd();

if (workspaceIndex !== -1) {
  const arg = args[workspaceIndex];
  let rawWorkspace = null;

  if (arg.includes('=')) {
    rawWorkspace = arg.substring(arg.indexOf('=') + 1);
  } else if (workspaceIndex + 1 < args.length) {
    rawWorkspace = args[workspaceIndex + 1];
  }

  // Check if IDE variable was expanded, otherwise use provided path
  if (rawWorkspace && !rawWorkspace.includes('${')) {
    workspaceDir = path.resolve(process.cwd(), rawWorkspace);
  }
}

console.error(`[Server] Active Workspace: ${workspaceDir}`);

// Global state
let embedder = null;
let cache = null;
let indexer = null;
let hybridSearch = null;
let config = null;

// Server instance (moved up for global access)
const server = new Server(
  {
    name: "smart-coding-mcp",
    version: packageJson.version
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Init promise to coordinate startup
let readyPromise = null;

// Feature registry
const features = [
  {
    module: HybridSearchFeature,
    instance: null,
    handler: HybridSearchFeature.handleToolCall
  },
  {
    module: IndexCodebaseFeature,
    instance: null,
    handler: IndexCodebaseFeature.handleToolCall
  },
  {
    module: ClearCacheFeature,
    instance: null,
    handler: ClearCacheFeature.handleToolCall
  },
  {
    module: ConfigureFeature,
    instance: null,
    handler: ConfigureFeature.handleToolCall
  }
];

// Initialize application
async function initialize(rootPath) {
  console.error(`[Server] Initializing workspace: ${rootPath}`);

  // Load configuration with workspace support
  config = await loadConfig(rootPath);

  // Ensure search directory exists
  try {
    await fs.access(config.searchDirectory);
  } catch {
    console.error(`[Server] Error: Search directory "${config.searchDirectory}" does not exist`);
    // Don't exit process, just throw to handle gracefully
    throw new Error(`Search directory "${config.searchDirectory}" does not exist`);
  }

  // Load AI model
  console.error("[Server] Loading AI embedding model (this may take time on first run)...");
  embedder = await pipeline("feature-extraction", config.embeddingModel);

  // Initialize cache
  cache = new EmbeddingsCache(config);
  await cache.load();

  // Initialize features
  indexer = new CodebaseIndexer(embedder, cache, config, server);
  hybridSearch = new HybridSearch(embedder, cache, config);
  const cacheClearer = new ClearCacheFeature.CacheClearer(embedder, cache, config, indexer);
  const configurator = new ConfigureFeature.Configure(config);

  // Store feature instances
  features[0].instance = hybridSearch;
  features[1].instance = indexer;
  features[2].instance = cacheClearer;
  features[3].instance = configurator;

  // Start indexing in background (non-blocking)
  console.error("[Server] Starting background indexing...");
  indexer.indexAll().then(() => {
    if (config.watchFiles) {
      indexer.setupFileWatcher();
    }
  }).catch(err => {
    console.error("[Server] Background indexing error:", err.message);
  });

  return true;
}

// Handle Initialize Request (Handshake)
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  // If not already initializing (from CLI args), try to init from protocol
  if (!readyPromise) {
    let rootPath = process.cwd(); // Fallback

    // Strategy 1: Check rootUri
    if (request.params.rootUri) {
      try {
        const uri = request.params.rootUri;
        if (uri.startsWith('file://')) {
          rootPath = fileURLToPath(uri);
        }
      } catch (err) {
        console.error(`[Server] Failed to parse rootUri: ${err.message}`);
      }
    }
    // Strategy 2: Check workspaceFolders (Array)
    else if (request.params.workspaceFolders && request.params.workspaceFolders.length > 0) {
      const firstFolder = request.params.workspaceFolders[0];
      try {
        if (firstFolder.uri.startsWith('file://')) {
          rootPath = fileURLToPath(firstFolder.uri);
        }
      } catch (err) {
        console.error(`[Server] Failed to parse workspaceFolder: ${err.message}`);
      }
    }

    console.error(`[Server] Auto-detected workspace: ${rootPath}`);

    readyPromise = initialize(rootPath).catch(err => {
      console.error(`[Server] Critical initialization failure: ${err.message}`);
      process.exit(1);
    });
  }

  return {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {}
    },
    serverInfo: {
      name: "smart-coding-mcp",
      version: packageJson.version
    }
  };
});

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Wait for init
  if (readyPromise) await readyPromise;

  const tools = [];
  // Guard against uninitialized state
  if (!config) return { tools: [] };

  for (const feature of features) {
    const toolDef = feature.module.getToolDefinition(config);
    tools.push(toolDef);
  }

  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (readyPromise) await readyPromise;

  for (const feature of features) {
    // If config is not loaded yet, we can't get definitions, but we shouldn't be here if listTools worked?
    // Safety check
    if (!config) continue;

    const toolDef = feature.module.getToolDefinition(config);

    if (request.params.name === toolDef.name) {
      return await feature.handler(request, feature.instance);
    }
  }

  return {
    content: [{
      type: "text",
      text: `Unknown tool: ${request.params.name}`
    }]
  };
});

// Main entry point
// Main entry point
async function main() {
  // If workspace was explicitly provided via CLI, start initializing immediately
  if (workspaceIndex !== -1) {
    console.error(`[Server] CLI argument detected. Starting immediate initialization for: ${workspaceDir}`);
    readyPromise = initialize(workspaceDir).catch(err => {
      console.error(`[Server] Critical initialization failure: ${err.message}`);
      process.exit(1);
    });
  } else {
    // Zero-Config Mode: Defer initialization until client handshake
    console.error(`[Server] No CLI workspace arg. Waiting for MCP 'initialize' handshake...`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[Server] Smart Coding MCP server ready!");

  // cleanup on exit
  process.stdin.resume(); // Ensure it's flowing
  process.stdin.on('close', () => {
    console.error("[Server] stdin closed, shutting down...");
    process.exit(0);
  });

  // Also handle writing to closed stdout causing errors
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') {
      process.exit(0);
    }
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error("\n[Server] Shutting down gracefully...");

  // Stop file watcher
  if (indexer && indexer.watcher) {
    await indexer.watcher.close();
    console.error("[Server] File watcher stopped");
  }

  // Save cache
  if (cache) {
    await cache.save();
    console.error("[Server] Cache saved");
  }

  console.error("[Server] Goodbye!");
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error("\n[Server] Received SIGTERM, shutting down...");
  process.exit(0);
});

main().catch(console.error);