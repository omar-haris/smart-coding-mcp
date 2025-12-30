import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { ProjectDetector } from "./project-detector.js";

const DEFAULT_CONFIG = {
  searchDirectory: ".",
  fileExtensions: [
    "js", "ts", "jsx", "tsx", "mjs", "cjs",
    "css", "scss", "sass", "less", "styl",
    "html", "htm", "xml", "svg",
    "py", "pyw", "pyx",
    "java", "kt", "kts", "scala",
    "c", "cpp", "cc", "cxx", "h", "hpp", "hxx",
    "cs", "csx",
    "go",
    "rs",
    "rb", "rake",
    "php", "phtml",
    "swift",
    "sh", "bash", "zsh", "fish",
    "json", "yaml", "yml", "toml", "ini", "env",
    "md", "mdx", "txt", "rst",
    "sql",
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
  chunkSize: 25,
  chunkOverlap: 5,
  batchSize: 100,
  maxFileSize: 1048576,
  maxResults: 5,
  enableCache: true,
  cacheDirectory: "./.smart-coding-cache",
  watchFiles: false,
  verbose: false,
  workerThreads: "auto",
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
  semanticWeight: 0.7,
  exactMatchBoost: 1.5,
  smartIndexing: true
};

let config = { ...DEFAULT_CONFIG };

export async function loadConfig(workspaceDir = null) {
  // 1. Determine Active Workspace (Default to CWD)
  const activeDir = workspaceDir ? path.resolve(workspaceDir) : process.cwd();

  // 2. Local Encapsulation Directory
  const localDir = path.join(activeDir, ".smart-coding-cache");
  const localConfigPath = path.join(localDir, "config.json");

  // Ensure the encapsulated folder exists
  await fs.mkdir(localDir, { recursive: true });
  await ensureHidden(localDir);

  // 3. Load Project-Local Config from .smart-coding-cache/config.json
  let userConfig = {};
  let configData;
  try {
    configData = await fs.readFile(localConfigPath, "utf-8");
  } catch (readError) {
    if (readError.code === 'ENOENT') {
      // If config doesn't exist, create it with defaults (Zero-Touch setup)
      await fs.writeFile(localConfigPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
      console.error(`[Config] Created new encapsulated configuration: ${localConfigPath}`);
      configData = JSON.stringify(DEFAULT_CONFIG);
    } else {
      throw readError;
    }
  }

  try {
    userConfig = JSON.parse(configData);
    console.error(`[Config] Using encapsulated configuration: ${localConfigPath}`);
  } catch (parseError) {
    console.error(`[Config] Malformed JSON in ${localConfigPath}: ${parseError.message}`);
    throw parseError; // Fail fast on syntax errors
  }

  // 4. Merge defaults with user overrides
  config = { ...DEFAULT_CONFIG, ...userConfig };

  // 5. Force Encapsulated Paths
  config.searchDirectory = activeDir;
  config.cacheDirectory = localDir;

  // 6. Smart project detection
  if (config.smartIndexing !== false) {
    const detector = new ProjectDetector(config.searchDirectory);
    const detectedTypes = await detector.detectProjectTypes();

    if (detectedTypes.length > 0) {
      const smartPatterns = detector.getSmartIgnorePatterns();
      const existingExcludes = config.excludePatterns || [];
      config.excludePatterns = [...new Set([...smartPatterns, ...existingExcludes])];
      console.error(`[Config] Project type detected: ${detectedTypes.join(', ')}`);
      console.error(`[Config] Smart ignore rules applied: ${smartPatterns.length} patterns`);
    } else {
      console.error(`[Config] No specific project type detected. Using generic ignore rules.`);
    }
  }

  console.error(`[Config] Active workspace resolved: ${activeDir}`);
  console.error(`[Config] Persistence folder: ${localDir}`);

  applyEnvOverrides(config);
  return config;
}

/**
 * Saves configuration to the encapsulated project folder
 * @param {Object} updates - Settings to update
 * @param {string|null} workspaceDir - Optional target directory (defaults to active workspace)
 */
export async function saveGlobalConfig(updates, workspaceDir = null) {
  try {
    const activeDir = workspaceDir ? path.resolve(workspaceDir) : path.resolve(config.searchDirectory || process.cwd());
    const localDir = path.join(activeDir, ".smart-coding-cache");
    const localConfigPath = path.join(localDir, "config.json");

    await fs.mkdir(localDir, { recursive: true });
    await ensureHidden(localDir);

    let current = {};
    try {
      const data = await fs.readFile(localConfigPath, "utf-8");
      try {
        current = JSON.parse(data);
      } catch (parseError) {
        console.error(`[Config] Failed to parse existing config in ${localConfigPath}: ${parseError.message}`);
        throw parseError; // Abort save to prevent overwriting
      }
    } catch (readError) {
      if (readError.code !== 'ENOENT') {
        throw readError; // Re-throw permission errors, etc.
      }
      // ENOENT is expected for new configs
    }

    const updated = { ...current, ...updates };
    await fs.writeFile(localConfigPath, JSON.stringify(updated, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error(`[Config] Failed to save encapsulated config: ${err.message}`);
    return false;
  }
}

function applyEnvOverrides(config) {
  const envMap = {
    SMART_CODING_VERBOSE: 'verbose',
    SMART_CODING_BATCH_SIZE: 'batchSize',
    SMART_CODING_MAX_FILE_SIZE: 'maxFileSize',
    SMART_CODING_CHUNK_SIZE: 'chunkSize',
    SMART_CODING_MAX_RESULTS: 'maxResults',
    SMART_CODING_WATCH_FILES: 'watchFiles',
    SMART_CODING_SEMANTIC_WEIGHT: 'semanticWeight',
    SMART_CODING_EMBEDDING_MODEL: 'embeddingModel',
    SMART_CODING_WORKER_THREADS: 'workerThreads'
  };

  for (const [env, key] of Object.entries(envMap)) {
    if (process.env[env] !== undefined) {
      const val = process.env[env];
      if (val === 'true' || val === 'false') config[key] = val === 'true';
      else {
        // Strict numeric validation
        const trimmed = val.trim();
        if (trimmed.length > 0) {
          const num = Number(trimmed);
          if (Number.isFinite(num)) {
            config[key] = num;
            continue;
          }
        }
        config[key] = val;
      }
    }
  }
}

/**
 * Ensures a directory is hidden on Windows
 */
async function ensureHidden(dirPath) {
  if (process.platform === 'win32') {
    try {
      const normalizedPath = path.normalize(dirPath);
      await new Promise((resolve, reject) => {
        execFile('attrib', ['+h', normalizedPath], (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch (err) {
      console.error(`[Config] Failed to set hidden attribute: ${err.message}`);
    }
  }
}

export function getConfig() { return config; }
export { DEFAULT_CONFIG };
