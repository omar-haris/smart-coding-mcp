#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import { createRequire } from "module";

// Import package.json for version
const require = createRequire(import.meta.url);
const packageJson = require("./package.json");

import { loadConfig } from "./lib/config.js";
import { SQLiteCache } from "./lib/sqlite-cache.js";
import { createEmbedder } from "./lib/mrl-embedder.js";
import { CodebaseIndexer } from "./features/index-codebase.js";
import { HybridSearch } from "./features/hybrid-search.js";

import * as IndexCodebaseFeature from "./features/index-codebase.js";
import * as HybridSearchFeature from "./features/hybrid-search.js";
import * as ClearCacheFeature from "./features/clear-cache.js";
import * as CheckLastVersionFeature from "./features/check-last-version.js";
import * as SetWorkspaceFeature from "./features/set-workspace.js";
import * as GetStatusFeature from "./features/get-status.js";

// Parse workspace from command line arguments
const args = process.argv.slice(2);
const workspaceIndex = args.findIndex((arg) => arg.startsWith("--workspace"));
let workspaceDir = process.cwd(); // Default to current directory

if (workspaceIndex !== -1) {
  const arg = args[workspaceIndex];
  let rawWorkspace = null;

  if (arg.includes("=")) {
    rawWorkspace = arg.split("=")[1];
  } else if (workspaceIndex + 1 < args.length) {
    rawWorkspace = args[workspaceIndex + 1];
  }

  // Check if IDE variable wasn't expanded (contains ${})
  if (rawWorkspace && rawWorkspace.includes("${")) {
    console.error(
      `[Server] FATAL: Workspace variable "${rawWorkspace}" was not expanded by your IDE.`
    );
    console.error(
      `[Server] This typically means your MCP client does not support dynamic variables.`
    );
    console.error(
      `[Server] Please use an absolute path instead: --workspace /path/to/your/project`
    );
    process.exit(1);
  } else if (rawWorkspace) {
    workspaceDir = rawWorkspace;
  }

  if (workspaceDir) {
    console.error(`[Server] Workspace mode: ${workspaceDir}`);
  }
}

// Global state
let embedder = null;
let cache = null;
let indexer = null;
let hybridSearch = null;
let config = null;
let isInitialized = false;
let initializationPromise = null;

// Feature registry - ordered by priority (semantic_search first as primary tool)
const features = [
  {
    module: HybridSearchFeature,
    instance: null,
    handler: HybridSearchFeature.handleToolCall,
  },
  {
    module: IndexCodebaseFeature,
    instance: null,
    handler: IndexCodebaseFeature.handleToolCall,
  },
  {
    module: ClearCacheFeature,
    instance: null,
    handler: ClearCacheFeature.handleToolCall,
  },
  {
    module: CheckLastVersionFeature,
    instance: null,
    handler: CheckLastVersionFeature.handleToolCall,
  },
  {
    module: SetWorkspaceFeature,
    instance: null,
    handler: SetWorkspaceFeature.handleToolCall,
  },
  {
    module: GetStatusFeature,
    instance: null,
    handler: GetStatusFeature.handleToolCall,
  },
];

/**
 * Lazy initialization - only loads heavy resources when first needed
 * This prevents IDE blocking on startup
 */
async function ensureInitialized() {
  // Already initialized
  if (isInitialized) {
    return;
  }

  // Initialization in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    console.error("[Server] Loading AI model and cache (first use)...");

    // Load AI model using MRL embedder factory
    embedder = await createEmbedder(config);
    console.error(
      `[Server] Model: ${embedder.modelName} (${embedder.dimension}d, device: ${embedder.device})`
    );

    // Initialize cache
    cache = new SQLiteCache(config);
    await cache.load();

    // Initialize features
    indexer = new CodebaseIndexer(embedder, cache, config, server);
    hybridSearch = new HybridSearch(embedder, cache, config, indexer);
    const cacheClearer = new ClearCacheFeature.CacheClearer(
      embedder,
      cache,
      config,
      indexer
    );
    const versionChecker = new CheckLastVersionFeature.VersionChecker(config);

    // Store feature instances (matches features array order)
    features[0].instance = hybridSearch;
    features[1].instance = indexer;
    features[2].instance = cacheClearer;
    features[3].instance = versionChecker;

    // Initialize new tools
    const workspaceManager = new SetWorkspaceFeature.WorkspaceManager(
      config,
      cache,
      indexer
    );
    const statusReporter = new GetStatusFeature.StatusReporter(
      config,
      cache,
      indexer,
      embedder
    );
    features[4].instance = workspaceManager;
    features[5].instance = statusReporter;

    isInitialized = true;
    console.error("[Server] Model and cache loaded successfully");
  })();

  await initializationPromise;
}

// Initialize application (lightweight, non-blocking)
async function initialize() {
  // Load configuration with workspace support
  config = await loadConfig(workspaceDir);

  // Ensure search directory exists
  try {
    await fs.access(config.searchDirectory);
  } catch {
    console.error(
      `[Server] Error: Search directory "${config.searchDirectory}" does not exist`
    );
    process.exit(1);
  }

  console.error(
    "[Server] Configuration loaded. Model will load on first use (lazy initialization)."
  );

  // Optional: auto-index after delay
  if (config.autoIndexDelay && config.autoIndexDelay > 0) {
    console.error(
      `[Server] Auto-indexing will start after ${config.autoIndexDelay}ms delay...`
    );
    setTimeout(async () => {
      console.error("[Server] Starting auto-indexing...");
      try {
        await ensureInitialized();
        await indexer.indexAll();
        if (config.watchFiles) {
          indexer.setupFileWatcher();
        }
      } catch (err) {
        console.error("[Server] Auto-indexing error:", err.message);
      }
    }, config.autoIndexDelay);
  }
}

// Setup MCP server
const server = new Server(
  {
    name: "smart-coding-mcp",
    version: packageJson.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools from all features
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [];

  for (const feature of features) {
    const toolDef = feature.module.getToolDefinition(config);
    tools.push(toolDef);
  }

  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Ensure model and cache are loaded before handling any tool
  await ensureInitialized();
  
  for (const feature of features) {
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
async function main() {
  await initialize();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[Server] Smart Coding MCP server ready!");
}

// Graceful shutdown
process.on("SIGINT", async () => {
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

process.on("SIGTERM", async () => {
  console.error("\n[Server] Received SIGTERM, shutting down...");
  process.exit(0);
});

main().catch(console.error);
