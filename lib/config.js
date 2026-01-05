import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ProjectDetector } from "./project-detector.js";

const DEFAULT_CONFIG = {
  searchDirectory: ".",
  fileExtensions: [
    // ==========================================
    // JAVASCRIPT / TYPESCRIPT ECOSYSTEM
    // ==========================================
    "js", "ts", "jsx", "tsx", "mjs", "cjs", "mts", "cts",

    // ==========================================
    // WEB TECHNOLOGIES
    // ==========================================
    // Styles
    "css", "scss", "sass", "less", "styl", "pcss", "postcss",
    // Templates & Markup
    "html", "htm", "vue", "svelte", "astro",
    // Web Components
    "marko", "riot",

    // ==========================================
    // PYTHON ECOSYSTEM
    // ==========================================
    "py", "pyw", "pyx", "pxd", "pxi",

    // ==========================================
    // JVM LANGUAGES
    // ==========================================
    "java", "kt", "kts", "scala", "sc", "groovy", "gvy", "gradle", "clj", "cljs", "cljc",

    // ==========================================
    // .NET LANGUAGES
    // ==========================================
    "cs", "csx", "fs", "fsx", "fsi", "vb",

    // ==========================================
    // SYSTEMS PROGRAMMING
    // ==========================================
    // C/C++
    "c", "cpp", "cc", "cxx", "h", "hpp", "hxx", "hh", "ipp", "inl", "tpp",
    // Rust
    "rs",
    // Go
    "go",
    // Zig
    "zig",
    // Nim
    "nim", "nims",
    // D
    "d",
    // V
    "v", "vsh",
    // Odin
    "odin",
    // Carbon (Google)
    "carbon",

    // ==========================================
    // APPLE ECOSYSTEM
    // ==========================================
    "swift", "m", "mm",

    // ==========================================
    // SCRIPTING LANGUAGES
    // ==========================================
    // Ruby
    "rb", "rake", "gemspec", "ru", "erb",
    // PHP
    "php", "phtml", "php3", "php4", "php5", "php7", "phps", "blade.php",
    // Perl
    "pl", "pm", "t", "pod",
    // Lua
    "lua",
    // TCL
    "tcl", "tk",
    // AWK
    "awk",

    // ==========================================
    // SHELL & COMMAND LINE
    // ==========================================
    "sh", "bash", "zsh", "fish", "ksh", "csh", "tcsh",
    // PowerShell
    "ps1", "psm1", "psd1",
    // Batch
    "bat", "cmd",

    // ==========================================
    // FUNCTIONAL LANGUAGES
    // ==========================================
    // Haskell
    "hs", "lhs",
    // OCaml
    "ml", "mli",
    // F# (already above in .NET)
    // Elm
    "elm",
    // Elixir & Erlang
    "ex", "exs", "erl", "hrl",
    // Lisp family
    "lisp", "lsp", "cl", "el", "scm", "ss", "rkt",
    // PureScript
    "purs",
    // ReasonML / ReScript
    "re", "rei", "res", "resi",

    // ==========================================
    // DATA & STATISTICS
    // ==========================================
    "r", "R", "rmd", "jl", "sas", "do", "ado", "mata",

    // ==========================================
    // MOBILE DEVELOPMENT
    // ==========================================
    "dart",
    // Kotlin/Swift already covered

    // ==========================================
    // DATABASE & QUERY
    // ==========================================
    "sql", "psql", "plsql", "pgsql", "mysql",
    // GraphQL
    "graphql", "gql",
    // Prisma
    "prisma",

    // ==========================================
    // INFRASTRUCTURE AS CODE
    // ==========================================
    // Terraform/HCL
    "tf", "hcl",
    // Nix
    "nix",
    // Dhall
    "dhall",
    // Pulumi (uses regular languages)
    // Ansible/Chef/Puppet use YAML/Ruby

    // ==========================================
    // BUILD & CONFIG (code-like)
    // ==========================================
    "cmake", "mk", "makefile",
    // Bazel/Starlark
    "bzl", "bazel", "star",
    // Jsonnet
    "jsonnet", "libsonnet",
    // CUE
    "cue",

    // ==========================================
    // BLOCKCHAIN & SMART CONTRACTS
    // ==========================================
    "sol", "vy", "move", "cairo", "fe",

    // ==========================================
    // GPU & SHADERS
    // ==========================================
    // CUDA
    "cu", "cuh",
    // OpenCL
    "opencl",
    // Shaders
    "glsl", "hlsl", "wgsl", "vert", "frag", "geom", "comp", "tesc", "tese", "mesh",
    // Metal
    "metal",

    // ==========================================
    // HARDWARE DESCRIPTION
    // ==========================================
    "vhd", "vhdl", "sv", "svh",

    // ==========================================
    // SERIALIZATION & API
    // ==========================================
    "proto", "thrift", "avsc", "fbs",

    // ==========================================
    // MARKUP (code-like)
    // ==========================================
    "tex", "latex", "bib",
    // Typst
    "typ",

    // ==========================================
    // CONFIG (commonly searched)
    // ==========================================
    "json", "yaml", "yml", "toml",

    // ==========================================
    // LEGACY & ENTERPRISE
    // ==========================================
    "cbl", "cob", "cpy",  // COBOL
    "f", "for", "f90", "f95", "f03", "f08",  // Fortran
    "pas", "pp",  // Pascal
    "ada", "adb", "ads",  // Ada
    "abap",  // SAP ABAP
    "cls", "trigger",  // Salesforce Apex
    "rpg", "rpgle",  // IBM RPG
    "p", "i", "w",  // Progress/OpenEdge

    // ==========================================
    // OTHER
    // ==========================================
    "coffee",  // CoffeeScript
    "ls",  // LiveScript
    "cr",  // Crystal
    "pony",  // Pony
    "wren",  // Wren
    "io",  // Io
    "factor",  // Factor
    "forth", "4th",  // Forth
    "red", "reds",  // Red
    "ring",  // Ring
    "hx",  // Haxe
    "as",  // ActionScript
    "monkey",  // Monkey
    "gd",  // GDScript (Godot)
    "shader",  // Unity shaders
    "uc",  // UnrealScript
    "angelscript"  // AngelScript
  ],
  excludePatterns: [
    // ==========================================
    // DEPENDENCY DIRECTORIES
    // ==========================================
    "**/node_modules/**",
    "**/bower_components/**",
    "**/jspm_packages/**",
    "**/web_modules/**",
    "**/vendor/**",
    "**/vendors/**",
    "**/third_party/**",
    "**/third-party/**",
    "**/thirdparty/**",
    "**/external/**",
    "**/externals/**",
    "**/deps/**",
    "**/dependencies/**",
    "**/lib/**/*.min.js",
    "**/libs/**",
    "**/packages/**",
    "**/pkg/**",

    // ==========================================
    // BUILD OUTPUT
    // ==========================================
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/output/**",
    "**/target/**",
    "**/bin/**",
    "**/obj/**",
    "**/release/**",
    "**/debug/**",
    "**/publish/**",
    "**/artifacts/**",
    "**/compiled/**",
    "**/_build/**",
    "**/.build/**",
    "**/cmake-build-*/**",
    "**/CMakeFiles/**",

    // ==========================================
    // FRAMEWORK SPECIFIC BUILD
    // ==========================================
    "**/.next/**",
    "**/.nuxt/**",
    "**/.output/**",
    "**/.svelte-kit/**",
    "**/.astro/**",
    "**/.vercel/**",
    "**/.netlify/**",
    "**/.serverless/**",
    "**/.amplify/**",
    "**/.firebase/**",
    "**/.angular/**",
    "**/.expo/**",
    "**/android/build/**",
    "**/ios/build/**",
    "**/ios/Pods/**",
    "**/.gradle/**",
    "**/.dart_tool/**",
    "**/.pub-cache/**",
    "**/.flutter-plugins/**",
    "**/DerivedData/**",
    "**/xcuserdata/**",

    // ==========================================
    // VERSION CONTROL
    // ==========================================
    "**/.git/**",
    "**/.svn/**",
    "**/.hg/**",
    "**/.bzr/**",
    "**/.fossil/**",

    // ==========================================
    // CACHE DIRECTORIES
    // ==========================================
    "**/.cache/**",
    "**/.smart-coding-cache/**",
    "**/__pycache__/**",
    "**/.pytest_cache/**",
    "**/.mypy_cache/**",
    "**/.ruff_cache/**",
    "**/.hypothesis/**",
    "**/.tox/**",
    "**/.nox/**",
    "**/coverage/**",
    "**/.nyc_output/**",
    "**/htmlcov/**",
    "**/.phpunit.cache/**",
    "**/.phpcs-cache/**",
    "**/.php-cs-fixer.cache",
    "**/.eslintcache",
    "**/.stylelintcache",
    "**/.prettiercache",
    "**/.parcel-cache/**",
    "**/.turbo/**",
    "**/.nx/**",
    "**/.wireit/**",
    "**/tsconfig.tsbuildinfo",
    "**/*.tsbuildinfo",

    // ==========================================
    // VIRTUAL ENVIRONMENTS
    // ==========================================
    "**/venv/**",
    "**/.venv/**",
    "**/env/**",
    "**/ENV/**",
    "**/virtualenv/**",
    "**/.virtualenv/**",
    "**/conda/**",
    "**/.conda/**",
    "**/pipenv/**",

    // ==========================================
    // LOCK FILES
    // ==========================================
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/bun.lockb",
    "**/shrinkwrap.yaml",
    "**/composer.lock",
    "**/Gemfile.lock",
    "**/Cargo.lock",
    "**/poetry.lock",
    "**/Pipfile.lock",
    "**/pdm.lock",
    "**/uv.lock",
    "**/go.sum",
    "**/mix.lock",
    "**/pubspec.lock",
    "**/Package.resolved",
    "**/Podfile.lock",
    "**/flake.lock",
    "**/gradle.lockfile",
    "**/buildscript-gradle.lockfile",
    "**/pnpm-workspace.yaml",

    // ==========================================
    // AUTO-GENERATED CODE
    // ==========================================
    "**/*.d.ts",
    "**/*.d.mts",
    "**/*.d.cts",
    "**/*.generated.*",
    "**/*.auto.*",
    "**/*.g.dart",
    "**/*.freezed.dart",
    "**/*.gr.dart",
    "**/*.gen.*",
    "**/*_generated.*",
    "**/generated/**",
    "**/auto-generated/**",
    "**/autogen/**",
    "**/__generated__/**",
    "**/codegen/**",
    "**/.graphql/**",
    "**/*.pb.go",
    "**/*.pb.cc",
    "**/*.pb.h",
    "**/*.grpc.go",
    "**/*_grpc.pb.go",
    "**/*.swagger.json",
    "**/openapi.json",
    "**/openapi.yaml",
    "**/swagger.json",
    "**/swagger.yaml",

    // ==========================================
    // MINIFIED & BUNDLED
    // ==========================================
    "**/*.min.js",
    "**/*.min.css",
    "**/*.min.html",
    "**/*.bundle.js",
    "**/*.bundle.css",
    "**/*.chunk.js",
    "**/*.chunk.css",
    "**/*-bundle.js",
    "**/*-chunk.js",
    "**/vendor.js",
    "**/vendors.js",
    "**/polyfills.js",
    "**/runtime.js",
    "**/main.*.js",
    "**/app.*.js",
    "**/commons.*.js",
    "**/framework.*.js",
    "**/_buildManifest.js",
    "**/_ssgManifest.js",

    // ==========================================
    // SOURCE MAPS
    // ==========================================
    "**/*.map",
    "**/*.js.map",
    "**/*.css.map",

    // ==========================================
    // TEST FIXTURES & DATA
    // ==========================================
    "**/__fixtures__/**",
    "**/fixtures/**",
    "**/__mocks__/**",
    "**/mocks/**",
    "**/__snapshots__/**",
    "**/snapshots/**",
    "**/__tests__/data/**",
    "**/test-data/**",
    "**/testdata/**",
    "**/test_data/**",
    "**/test-fixtures/**",
    "**/test_fixtures/**",
    "**/spec/fixtures/**",
    "**/cypress/fixtures/**",
    "**/playwright/fixtures/**",

    // ==========================================
    // TEST OUTPUT
    // ==========================================
    "**/test-results/**",
    "**/test-output/**",
    "**/test_output/**",
    "**/playwright-report/**",
    "**/allure-results/**",
    "**/allure-report/**",
    "**/cypress/videos/**",
    "**/cypress/screenshots/**",
    "**/reports/**",
    "**/.reports/**",
    "**/junit/**",
    "**/xunit/**",

    // ==========================================
    // CI/CD CONFIGURATION
    // ==========================================
    "**/.github/**",
    "**/.gitlab/**",
    "**/.gitlab-ci.yml",
    "**/.circleci/**",
    "**/.travis.yml",
    "**/azure-pipelines.yml",
    "**/Jenkinsfile",
    "**/.drone.yml",
    "**/.woodpecker.yml",
    "**/bitbucket-pipelines.yml",
    "**/cloudbuild.yaml",
    "**/appveyor.yml",
    "**/buildkite/**",
    "**/.buildkite/**",
    "**/taskcluster/**",
    "**/wercker.yml",
    "**/codeship-*.yml",
    "**/.semaphore/**",
    "**/buddy.yml",
    "**/codefresh.yml",
    "**/.harness/**",
    "**/.argo/**",
    "**/skaffold.yaml",

    // ==========================================
    // IDE & EDITOR
    // ==========================================
    "**/.vscode/**",
    "**/.idea/**",
    "**/.vs/**",
    "**/.eclipse/**",
    "**/.settings/**",
    "**/.project",
    "**/.classpath",
    "**/*.sublime-project",
    "**/*.sublime-workspace",
    "**/.atom/**",
    "**/.fleet/**",
    "**/.zed/**",
    "**/*.code-workspace",
    "**/.devcontainer/**",

    // ==========================================
    // DOCUMENTATION (non-code)
    // ==========================================
    "**/CHANGELOG*",
    "**/CHANGES*",
    "**/HISTORY*",
    "**/LICENSE*",
    "**/LICENCE*",
    "**/COPYING*",
    "**/CONTRIBUTING*",
    "**/CONTRIBUTORS*",
    "**/AUTHORS*",
    "**/SECURITY*",
    "**/CODE_OF_CONDUCT*",
    "**/CODEOWNERS",
    "**/OWNERS",
    "**/MAINTAINERS*",
    "**/README*",
    "**/ROADMAP*",
    "**/ARCHITECTURE*",
    "**/DESIGN*",
    "**/docs/**",
    "**/documentation/**",
    "**/.docsify/**",
    "**/site/**",
    "**/_site/**",
    "**/.docusaurus/**",
    "**/docusaurus.config.*",
    "**/.vuepress/**",
    "**/.vitepress/**",
    "**/mkdocs.yml",
    "**/book/**",
    "**/man/**",
    "**/manpages/**",
    "**/wiki/**",
    "**/api-docs/**",
    "**/apidocs/**",

    // ==========================================
    // CONFIG FILES (not code)
    // ==========================================
    // TypeScript/JavaScript
    "**/tsconfig*.json",
    "**/jsconfig*.json",
    "**/.eslintrc*",
    "**/.eslintignore",
    "**/.prettierrc*",
    "**/.prettierignore",
    "**/.babelrc*",
    "**/babel.config.*",
    "**/.swcrc",
    "**/.browserslistrc",
    "**/browserslist",
    "**/.editorconfig",
    "**/.npmrc",
    "**/.nvmrc",
    "**/.node-version",
    "**/.yarnrc*",
    "**/.pnpmfile.cjs",
    "**/lerna.json",
    "**/nx.json",
    "**/turbo.json",
    "**/rush.json",
    // Python
    "**/pyproject.toml",
    "**/setup.cfg",
    "**/setup.py",
    "**/pytest.ini",
    "**/tox.ini",
    "**/noxfile.py",
    "**/.flake8",
    "**/.pylintrc",
    "**/pylintrc",
    "**/.bandit",
    "**/.coveragerc",
    "**/mypy.ini",
    "**/.mypy.ini",
    "**/pyrightconfig.json",
    "**/pycodestyle.cfg",
    "**/MANIFEST.in",
    // Ruby
    "**/.rubocop*.yml",
    "**/.ruby-version",
    "**/.ruby-gemset",
    "**/.rvmrc",
    "**/Rakefile",
    // PHP
    "**/phpcs.xml*",
    "**/phpstan.neon*",
    "**/psalm.xml*",
    "**/phpunit.xml*",
    // Java/Kotlin
    "**/pom.xml",
    "**/build.gradle*",
    "**/settings.gradle*",
    "**/gradle.properties",
    "**/gradlew*",
    "**/.mvn/**",
    "**/mvnw*",
    "**/checkstyle.xml",
    "**/spotbugs.xml",
    // Go
    "**/.golangci.yml",
    "**/staticcheck.conf",
    // Rust
    "**/rustfmt.toml",
    "**/clippy.toml",
    "**/rust-toolchain*",
    "**/.cargo/config*",
    // General
    "**/.gitignore",
    "**/.gitattributes",
    "**/.gitmodules",
    "**/.mailmap",
    "**/.gitkeep",
    "**/.keep",
    "**/.dockerignore",
    "**/.helmignore",
    "**/Dockerfile*",
    "**/docker-compose*.yml",
    "**/compose*.yml",
    "**/*.dockerfile",
    "**/Makefile",
    "**/makefile",
    "**/GNUmakefile",
    "**/Procfile",
    "**/Vagrantfile",

    // ==========================================
    // ENVIRONMENT & SECRETS
    // ==========================================
    "**/.env*",
    "**/env.*",
    "**/*.env",
    "**/secrets.*",
    "**/credentials.*",
    "**/service-account*.json",
    "**/gcloud/**",
    "**/.aws/**",
    "**/.azure/**",
    "**/.kube/**",
    "**/.docker/**",
    "**/id_rsa*",
    "**/id_ed25519*",
    "**/id_ecdsa*",
    "**/*.pem",
    "**/*.key",
    "**/*.crt",
    "**/*.cer",
    "**/*.p12",
    "**/*.pfx",
    "**/*.keystore",
    "**/*.jks",
    "**/*.gpg",
    "**/*.asc",
    "**/.netrc",
    "**/.npmrc",
    "**/.pypirc",

    // ==========================================
    // LOGS & TEMPORARY
    // ==========================================
    "**/*.log",
    "**/logs/**",
    "**/.logs/**",
    "**/log/**",
    "**/tmp/**",
    "**/temp/**",
    "**/.tmp/**",
    "**/.temp/**",
    "**/*.tmp",
    "**/*.temp",
    "**/*.bak",
    "**/*.backup",
    "**/*.swp",
    "**/*.swo",
    "**/*~",
    "**/#*#",
    "**/.#*",

    // ==========================================
    // OS FILES
    // ==========================================
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/desktop.ini",
    "**/$RECYCLE.BIN/**",
    "**/._*",

    // ==========================================
    // BINARY & MEDIA (by extension)
    // ==========================================
    // Images
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.ico",
    "**/*.bmp",
    "**/*.webp",
    "**/*.svg",
    "**/*.tiff",
    "**/*.tif",
    "**/*.psd",
    "**/*.ai",
    "**/*.eps",
    "**/*.raw",
    "**/*.heic",
    "**/*.heif",
    "**/*.avif",
    "**/*.jxl",
    "**/*.xcf",
    // Fonts
    "**/*.woff",
    "**/*.woff2",
    "**/*.ttf",
    "**/*.otf",
    "**/*.eot",
    "**/*.fon",
    // Audio
    "**/*.mp3",
    "**/*.wav",
    "**/*.ogg",
    "**/*.m4a",
    "**/*.aac",
    "**/*.flac",
    "**/*.wma",
    "**/*.aiff",
    "**/*.opus",
    // Video
    "**/*.mp4",
    "**/*.avi",
    "**/*.mov",
    "**/*.mkv",
    "**/*.flv",
    "**/*.wmv",
    "**/*.webm",
    "**/*.m4v",
    "**/*.mpg",
    "**/*.mpeg",
    "**/*.3gp",
    // Documents
    "**/*.pdf",
    "**/*.doc",
    "**/*.docx",
    "**/*.xls",
    "**/*.xlsx",
    "**/*.ppt",
    "**/*.pptx",
    "**/*.odt",
    "**/*.ods",
    "**/*.odp",
    "**/*.rtf",
    "**/*.epub",
    // Archives
    "**/*.zip",
    "**/*.tar",
    "**/*.gz",
    "**/*.tgz",
    "**/*.rar",
    "**/*.7z",
    "**/*.bz2",
    "**/*.xz",
    "**/*.lz",
    "**/*.zst",
    // Databases
    "**/*.sqlite",
    "**/*.sqlite3",
    "**/*.db",
    "**/*.mdb",
    "**/*.rdb",
    // Compiled/Binary
    "**/*.so",
    "**/*.dylib",
    "**/*.dll",
    "**/*.exe",
    "**/*.o",
    "**/*.a",
    "**/*.lib",
    "**/*.class",
    "**/*.jar",
    "**/*.war",
    "**/*.ear",
    "**/*.pyc",
    "**/*.pyo",
    "**/*.whl",
    "**/*.egg",
    "**/*.beam",
    "**/*.wasm",
    // ML/Data
    "**/*.h5",
    "**/*.hdf5",
    "**/*.pkl",
    "**/*.pickle",
    "**/*.pt",
    "**/*.pth",
    "**/*.onnx",
    "**/*.pb",
    "**/*.tflite",
    "**/*.mlmodel",
    "**/*.safetensors",
    "**/*.gguf",
    "**/*.parquet",
    "**/*.arrow",
    "**/*.feather",
    "**/*.npy",
    "**/*.npz",

    // ==========================================
    // SPECIFIC FRAMEWORK PATTERNS
    // ==========================================
    // Rails
    "**/schema.rb",
    "**/structure.sql",
    // Django
    "**/migrations/0*.py",
    "**/migrations/__init__.py",
    // Laravel
    "**/storage/**",
    "**/bootstrap/cache/**"
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
