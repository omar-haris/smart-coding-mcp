import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

export class Configure {
    constructor(config) {
        this.config = config;
    }

    async configure(newPath, settings = {}) {
        // Validate path
        try {
            await fs.access(newPath);
        } catch {
            return { success: false, message: `Invalid path: ${newPath}. Directory does not exist.` };
        }

        // Determine config file location
        // Logic mirrored from loadConfig to find the global config.json
        const scriptDir = path.dirname(fileURLToPath(import.meta.url));
        const baseDir = path.resolve(scriptDir, '..');
        const configPath = path.join(baseDir, "config.json");

        let userConfig = {};
        try {
            const configData = await fs.readFile(configPath, "utf-8");
            userConfig = JSON.parse(configData);
        } catch {
            // Ignore, start fresh
        }

        // Update config
        userConfig.searchDirectory = newPath; // This is effectively the workspace path for the server logic
        userConfig.cacheDirectory = path.join(newPath, ".smart-coding-cache");

        // Apply optional settings
        if (settings.workerThreads !== undefined) userConfig.workerThreads = settings.workerThreads;
        if (settings.watchFiles !== undefined) userConfig.watchFiles = settings.watchFiles;

        // Save to global config.json
        try {
            await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2), "utf-8");
            return {
                success: true,
                message: `Configuration saved for workspace: ${newPath}. Settings: ${JSON.stringify(settings)}. Please reload the window/server to apply changes.`
            };
        } catch (error) {
            console.error(`[Configure] Failed to save config: ${error.message}`);
            return {
                success: false,
                message: `Failed to save config: ${error.message}`
            };
        }
    }
}

export function getToolDefinition(config) {
    return {
        name: "configure_workspace",
        description: "Dynamically configures the workspace path and performance settings. Use this if the server started in the wrong directory or is causing performance issues. Updates the global configuration file.",
        inputSchema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Absolute path to the project root directory you want to index (e.g. C:/Users/Name/Project)"
                },
                settings: {
                    type: "object",
                    description: "Optional performance settings",
                    properties: {
                        workerThreads: { type: "number", description: "Number of worker threads (1 for low resource usage)" },
                        watchFiles: { type: "boolean", description: "Enable/disable file watching" }
                    }
                }
            },
            required: ["path"]
        }
    };
}

export async function handleToolCall(request, instance) {
    const newPath = request.params.arguments.path;
    const settings = request.params.arguments.settings;

    const result = await instance.configure(newPath, settings);

    return {
        content: [{ type: "text", text: result.message }]
    };
}
