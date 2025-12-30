import fs from 'fs';
import path from 'path';
import os from 'os';

export function configureAntigravity() {
    // Platform specific paths
    const CONFIG_PATH = process.platform === 'win32'
        ? path.join(os.homedir(), '.gemini/antigravity/mcp_config.json')
        : path.join(os.homedir(), '.gemini/antigravity/mcp_config.json');

    const CURRENT_DIR = process.cwd();

    // Normalize path for JSON (forward slashes)
    const normalizePath = (p) => p.split(path.sep).join('/');

    console.log(`[Config] Updating Antigravity MCP config...`);
    console.log(`[Config] Target: ${CONFIG_PATH}`);
    console.log(`[Config] New Workspace: ${CURRENT_DIR}`);

    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            console.error(`[Error] Config file not found at ${CONFIG_PATH}`);
            console.error(`[Tip] Make sure you have opened Antigravity at least once.`);
            return false;
        }

        const content = fs.readFileSync(CONFIG_PATH, 'utf8');
        let config;
        try {
            config = JSON.parse(content);
        } catch (e) {
            console.error(`[Error] Failed to parse config JSON: ${e.message}`);
            return false;
        }

        if (!config.mcpServers || !config.mcpServers['smart-coding-mcp']) {
            console.error(`[Error] 'smart-coding-mcp' entry not found in config.`);
            console.error(`[Fix] Please add the server to your config first (see README).`);
            return false;
        }

        // Preserve existing command/env, just update args
        const server = config.mcpServers['smart-coding-mcp'];

        // We assume the first arg is the script path, keep it.
        // We want to replace/set the --workspace arg.
        let scriptPath = server.args[0];

        // Safety check: ensure we keep the path to index.js if it exists
        if (scriptPath && !scriptPath.includes('index.js')) {
            const indexArg = server.args.find(a => a.includes('index.js'));
            if (indexArg) scriptPath = indexArg;
        }

        // If we can't find index.js (e.g. npx case), we might need to be careful.
        // However, for the "npx" case, the args are ["-y", "smart-coding-mcp"].
        // If the user runs this setup, they are likely converting to the Explicit Path method.

        // Actually, if they are using 'npx smart-coding-mcp', their config is:
        // command: npx, args: [-y, smart-coding-mcp]
        // If they run this setup tool, we are switching them to explicit workspace mode.

        // IMPORTANT: If they are using npx, we just append --workspace.

        const newArgs = [...server.args];

        // Remove existing workspace args if any
        const workspaceIdx = newArgs.indexOf("--workspace");
        if (workspaceIdx !== -1) {
            newArgs.splice(workspaceIdx, 2); // Remove flag and value
        }

        // Append new workspace
        newArgs.push("--workspace", normalizePath(CURRENT_DIR));

        server.args = newArgs;

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[Success] Updated config to index: ${normalizePath(CURRENT_DIR)}`);
        console.log(`[Action] Please RELOAD your Antigravity window now.`);
        return true;

    } catch (err) {
        console.error(`[Error] Failed to update config: ${err.message}`);
        return false;
    }
}
