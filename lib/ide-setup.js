import fs from 'fs';
import path from 'path';
import os from 'os';

export function configureAntigravity() {
    // Platform specific paths
    const CONFIG_PATH = path.join(os.homedir(), '.gemini/antigravity/mcp_config.json');

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

        // Ensure args is an array
        const currentArgs = Array.isArray(server.args) ? server.args : [];
        const newArgs = [...currentArgs];

        // Remove existing workspace args if any
        const workspaceIdx = newArgs.indexOf("--workspace");
        if (workspaceIdx !== -1) {
            // Only remove value if it looks like a value (not another flag)
            const hasValue = workspaceIdx + 1 < newArgs.length && !newArgs[workspaceIdx + 1].startsWith('-');
            newArgs.splice(workspaceIdx, hasValue ? 2 : 1);
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
