import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ProjectDetector } from "./project-detector.js";

const DEFAULT_CONFIG = {
  searchDirectory: ".",
  fileExtensions: [
    // JavaScript/TypeScript
    "js", "ts", "jsx", "tsx", "mjs", "cjs",
    // Styles
    "css", "scss", "sass", "less", "styl",
    // Markup
    "html", "htm", "xml", "svg",
    // Python
    "py", "pyw", "pyx",
    // Java/Kotlin/Scala
    "java", "kt", "kts", "scala",
    // C/C++
    "c", "cpp", "cc", "cxx", "h", "hpp", "hxx",
    // C#
    "cs", "csx",
    // Go
    "go",
    // Rust
    "rs",
    // Ruby
    "rb", "rake",
    // PHP
    "php", "phtml",
    // Swift
    "swift",
    // Shell scripts
    "sh", "bash", "zsh", "fish",
    // Config & Data
    "json", "yaml", "yml", "toml", "ini", "env",
    // Documentation
    "md", "mdx", "txt", "rst",
    // Database
    "sql",
    // Other
    "r", "R", "lua", "vim", "pl", "pm"
  ],
  excludePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/coverage/**",
    "**/.next/**",
    "**/target/**",
    "**/vendor/**",
    "**/.smart-coding-cache/**"
  ],
  chunkSize: 25, // Lines per chunk (larger = fewer embeddings = faster indexing)
  chunkOverlap: 5, // Overlap between chunks for context continuity
  batchSize: 100,
  maxFileSize: 1048576, // 1MB - skip files larger than this
  maxResults: 5,
  enableCache: true,
  cacheDirectory: "./.smart-coding-cache",
  watchFiles: false,
  verbose: false,
  workerThreads: "auto", // "auto" = CPU cores - 1, or set a number
  embeddingModel: "nomic-ai/nomic-embed-text-v1.5",
  embeddingDimension: 128, // MRL dimension: 64, 128, 256, 512, 768 (changed from 256 to 128 for better performance)
  device: "auto", // "cpu", "webgpu", or "auto"
  chunkingMode: "smart", // "smart", "ast", or "line"
  semanticWeight: 0.7,
  exactMatchBoost: 1.5,
  smartIndexing: true,
  
  // Resource throttling (prevents CPU exhaustion)
  maxCpuPercent: 25,        // Max CPU usage during indexing (default: 25%)
  batchDelay: 250,          // Delay between batches in ms (default: 250)
  maxWorkers: 'auto',       // Max worker threads ('auto' = 25% of cores, or specific number)
  
  // Startup behavior
  autoIndexDelay: null,     // Delay before auto-indexing (ms), null = disabled (lazy index on first search)
  
  // Progressive indexing
  incrementalSaveInterval: 5, // Save to cache every N batches
  allowPartialSearch: true    // Allow searches while indexing is in progress
};

let config = { ...DEFAULT_CONFIG };

export async function loadConfig(workspaceDir = null) {
  try {
    // Determine the base directory for configuration
    let baseDir;
    let configPath;
    
    if (workspaceDir) {
      // Workspace mode: load config from workspace root
      baseDir = path.resolve(workspaceDir);
      configPath = path.join(baseDir, "config.json");
      console.error(`[Config] Workspace mode: ${baseDir}`);
    } else {
      // Server mode: load config from server directory
      const scriptDir = path.dirname(fileURLToPath(import.meta.url));
      baseDir = path.resolve(scriptDir, '..');
      configPath = path.join(baseDir, "config.json");
    }
    
    let userConfig = {};
    try {
      const configData = await fs.readFile(configPath, "utf-8");
      userConfig = JSON.parse(configData);
    } catch (configError) {
      if (workspaceDir) {
        console.error(`[Config] No config.json in workspace, using defaults`);
      } else {
        console.error(`[Config] No config.json found: ${configError.message}`);
      }
    }
    
    config = { ...DEFAULT_CONFIG, ...userConfig };
    
    // Set workspace-specific directories
    if (workspaceDir) {
      config.searchDirectory = baseDir;
      config.cacheDirectory = path.join(baseDir, ".smart-coding-cache");
    } else {
      config.searchDirectory = path.resolve(baseDir, config.searchDirectory);
      config.cacheDirectory = path.resolve(baseDir, config.cacheDirectory);
    }
    
    // Smart project detection
    if (config.smartIndexing !== false) {
      const detector = new ProjectDetector(config.searchDirectory);
      const detectedTypes = await detector.detectProjectTypes();
      
      if (detectedTypes.length > 0) {
        const smartPatterns = detector.getSmartIgnorePatterns();
        
        // Merge smart patterns with user patterns (user patterns take precedence)
        const userPatterns = userConfig.excludePatterns || [];
        config.excludePatterns = [
          ...smartPatterns,
          ...userPatterns
        ];
        
        console.error(`[Config] Smart indexing: ${detectedTypes.join(', ')}`);
        console.error(`[Config] Applied ${smartPatterns.length} smart ignore patterns`);
      } else {
        console.error("[Config] No project markers detected, using default patterns");
      }
    }
    
    console.error("[Config] Loaded configuration from config.json");
  } catch (error) {
    console.error("[Config] Using default configuration (config.json not found or invalid)");
    console.error(`[Config] Error: ${error.message}`);
  }
  
  // Apply environment variable overrides (prefix: SMART_CODING_) with validation
  if (process.env.SMART_CODING_VERBOSE !== undefined) {
    const value = process.env.SMART_CODING_VERBOSE;
    if (value === 'true' || value === 'false') {
      config.verbose = value === 'true';
    }
  }
  
  if (process.env.SMART_CODING_BATCH_SIZE !== undefined) {
    const value = parseInt(process.env.SMART_CODING_BATCH_SIZE, 10);
    if (!isNaN(value) && value > 0 && value <= 1000) {
      config.batchSize = value;
    } else {
      console.error(`[Config] Invalid SMART_CODING_BATCH_SIZE: ${process.env.SMART_CODING_BATCH_SIZE}, using default`);
    }
  }
  
  if (process.env.SMART_CODING_MAX_FILE_SIZE !== undefined) {
    const value = parseInt(process.env.SMART_CODING_MAX_FILE_SIZE, 10);
    if (!isNaN(value) && value > 0) {
      config.maxFileSize = value;
    } else {
      console.error(`[Config] Invalid SMART_CODING_MAX_FILE_SIZE: ${process.env.SMART_CODING_MAX_FILE_SIZE}, using default`);
    }
  }
  
  if (process.env.SMART_CODING_CHUNK_SIZE !== undefined) {
    const value = parseInt(process.env.SMART_CODING_CHUNK_SIZE, 10);
    if (!isNaN(value) && value > 0 && value <= 100) {
      config.chunkSize = value;
    } else {
      console.error(`[Config] Invalid SMART_CODING_CHUNK_SIZE: ${process.env.SMART_CODING_CHUNK_SIZE}, using default`);
    }
  }
  
  if (process.env.SMART_CODING_MAX_RESULTS !== undefined) {
    const value = parseInt(process.env.SMART_CODING_MAX_RESULTS, 10);
    if (!isNaN(value) && value > 0 && value <= 100) {
      config.maxResults = value;
    } else {
      console.error(`[Config] Invalid SMART_CODING_MAX_RESULTS: ${process.env.SMART_CODING_MAX_RESULTS}, using default`);
    }
  }
  
  if (process.env.SMART_CODING_SMART_INDEXING !== undefined) {
    const value = process.env.SMART_CODING_SMART_INDEXING;
    if (value === 'true' || value === 'false') {
      config.smartIndexing = value === 'true';
    }
  }
  
  if (process.env.SMART_CODING_WATCH_FILES !== undefined) {
    const value = process.env.SMART_CODING_WATCH_FILES;
    if (value === 'true' || value === 'false') {
      config.watchFiles = value === 'true';
    }
  }
  
  if (process.env.SMART_CODING_SEMANTIC_WEIGHT !== undefined) {
    const value = parseFloat(process.env.SMART_CODING_SEMANTIC_WEIGHT);
    if (!isNaN(value) && value >= 0 && value <= 1) {
      config.semanticWeight = value;
    } else {
      console.error(`[Config] Invalid SMART_CODING_SEMANTIC_WEIGHT: ${process.env.SMART_CODING_SEMANTIC_WEIGHT}, using default (must be 0-1)`);
    }
  }
  
  if (process.env.SMART_CODING_EXACT_MATCH_BOOST !== undefined) {
    const value = parseFloat(process.env.SMART_CODING_EXACT_MATCH_BOOST);
    if (!isNaN(value) && value >= 0) {
      config.exactMatchBoost = value;
    } else {
      console.error(`[Config] Invalid SMART_CODING_EXACT_MATCH_BOOST: ${process.env.SMART_CODING_EXACT_MATCH_BOOST}, using default`);
    }
  }
  
  if (process.env.SMART_CODING_EMBEDDING_MODEL !== undefined) {
    const value = process.env.SMART_CODING_EMBEDDING_MODEL.trim();
    if (value.length > 0) {
      config.embeddingModel = value;
      console.error(`[Config] Using custom embedding model: ${value}`);
    }
  }
  
  if (process.env.SMART_CODING_WORKER_THREADS !== undefined) {
    const value = process.env.SMART_CODING_WORKER_THREADS.trim().toLowerCase();
    if (value === 'auto') {
      config.workerThreads = 'auto';
    } else {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue) && numValue >= 1 && numValue <= 32) {
        config.workerThreads = numValue;
      } else {
        console.error(`[Config] Invalid SMART_CODING_WORKER_THREADS: ${value}, using default (must be 'auto' or 1-32)`);
      }
    }
  }
  
  // MRL embedding dimension
  if (process.env.SMART_CODING_EMBEDDING_DIMENSION !== undefined) {
    const value = parseInt(process.env.SMART_CODING_EMBEDDING_DIMENSION, 10);
    const validDims = [64, 128, 256, 512, 768];
    if (validDims.includes(value)) {
      config.embeddingDimension = value;
      console.error(`[Config] Using embedding dimension: ${value}`);
    } else {
      console.error(`[Config] Invalid SMART_CODING_EMBEDDING_DIMENSION: ${value}, using default (must be 64, 128, 256, 512, or 768)`);
    }
  }
  
  // Device selection
  if (process.env.SMART_CODING_DEVICE !== undefined) {
    const value = process.env.SMART_CODING_DEVICE.trim().toLowerCase();
    const validDevices = ['cpu', 'webgpu', 'auto'];
    if (validDevices.includes(value)) {
      config.device = value;
      console.error(`[Config] Using device: ${value}`);
    } else {
      console.error(`[Config] Invalid SMART_CODING_DEVICE: ${value}, using default (must be 'cpu', 'webgpu', or 'auto')`);
    }
  }
  
  // Chunking mode
  if (process.env.SMART_CODING_CHUNKING_MODE !== undefined) {
    const value = process.env.SMART_CODING_CHUNKING_MODE.trim().toLowerCase();
    const validModes = ['smart', 'ast', 'line'];
    if (validModes.includes(value)) {
      config.chunkingMode = value;
      console.error(`[Config] Using chunking mode: ${value}`);
    } else {
      console.error(`[Config] Invalid SMART_CODING_CHUNKING_MODE: ${value}, using default (must be 'smart', 'ast', or 'line')`);
    }
  }
  
  // Resource throttling - Max CPU percent
  if (process.env.SMART_CODING_MAX_CPU_PERCENT !== undefined) {
    const value = parseInt(process.env.SMART_CODING_MAX_CPU_PERCENT, 10);
    if (!isNaN(value) && value >= 10 && value <= 100) {
      config.maxCpuPercent = value;
      console.error(`[Config] Max CPU usage: ${value}%`);
    } else {
      console.error(`[Config] Invalid SMART_CODING_MAX_CPU_PERCENT: ${value}, using default (must be 10-100)`);
    }
  }
  
  // Resource throttling - Batch delay
  if (process.env.SMART_CODING_BATCH_DELAY !== undefined) {
    const value = parseInt(process.env.SMART_CODING_BATCH_DELAY, 10);
    if (!isNaN(value) && value >= 0 && value <= 5000) {
      config.batchDelay = value;
      console.error(`[Config] Batch delay: ${value}ms`);
    } else {
      console.error(`[Config] Invalid SMART_CODING_BATCH_DELAY: ${value}, using default (must be 0-5000)`);
    }
  }
  
  // Resource throttling - Max workers
  if (process.env.SMART_CODING_MAX_WORKERS !== undefined) {
    const value = process.env.SMART_CODING_MAX_WORKERS.trim().toLowerCase();
    if (value === 'auto') {
      config.maxWorkers = 'auto';
    } else {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue) && numValue >= 1 && numValue <= 32) {
        config.maxWorkers = numValue;
        console.error(`[Config] Max workers: ${numValue}`);
      } else {
        console.error(`[Config] Invalid SMART_CODING_MAX_WORKERS: ${value}, using default (must be 'auto' or 1-32)`);
      }
    }
  }
  
  return config;
}

export function getConfig() {
  return config;
}

export { DEFAULT_CONFIG };
