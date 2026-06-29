#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.VIBEKIT_API_URL || "https://vibekit.bot/api/v1";
const API_KEY = process.env.VIBEKIT_API_KEY || "";
const SKILLS_REGISTRY = "https://raw.githubusercontent.com/vibekit-apps/skills-registry/main";

// Skills cache (TTL: 5 minutes)
let skillsCache: { manifest: unknown; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// API helper
async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  // The server boots and lists its tools without a key (so MCP introspection
  // works); a key is only required to actually call the VibeKit API.
  if (!API_KEY) {
    return {
      ok: false,
      error:
        "VIBEKIT_API_KEY is required. Get one at https://t.me/the_vibe_kit_bot with the /apikey command.",
    };
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();
    
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}


// Tool definitions live in tools.json — single source of truth, also rendered
// dynamically into the /mcp-server marketing page so it never drifts.
// require() resolves relative to the compiled file location at runtime;
// tools.json sits at the package root next to dist/, both when installed
// from npm and when run via tsx in dev.
import { readFileSync } from "fs";
import { join } from "path";

const TOOLS_MANIFEST_PATH = join(__dirname, "..", "tools.json");
const tools: Tool[] = JSON.parse(readFileSync(TOOLS_MANIFEST_PATH, "utf8")).map(
  (t: { name: string; description: string; inputSchema: Tool["inputSchema"] }): Tool => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })
);

// Tool handlers
async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  let result: { ok: boolean; data?: unknown; error?: string };

  switch (name) {
    // Hosting & Apps
    case "vibekit_list_apps":
      result = await apiRequest("GET", "/hosting/apps");
      break;

    case "vibekit_get_app":
      result = await apiRequest("GET", `/hosting/app/${args.appId}`);
      break;

    case "vibekit_create_app":
      result = await apiRequest("POST", "/hosting/apps", {
        template: args.template,
        subdomain: args.subdomain,
      });
      break;

    case "vibekit_list_templates":
      result = await apiRequest("GET", "/templates");
      break;

    case "vibekit_deploy":
      result = await apiRequest("POST", "/hosting/deploy", {
        repo: args.repo,
        subdomain: args.subdomain,
      });
      break;

    case "vibekit_redeploy":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/redeploy`);
      break;

    case "vibekit_app_logs": {
      let path = `/hosting/app/${args.appId}/logs`;
      if (args.lines) {
        path += `?lines=${args.lines}`;
      } else {
        path += "?lines=100";
      }
      result = await apiRequest("GET", path);
      break;
    }

    case "vibekit_restart_app":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/restart`);
      break;

    case "vibekit_stop_app":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/stop`);
      break;

    case "vibekit_start_app":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/start`);
      break;

    case "vibekit_app_env":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/env`);
      break;

    case "vibekit_set_env":
      result = await apiRequest("PUT", `/hosting/app/${args.appId}/env`, {
        vars: args.vars,
      });
      break;

    case "vibekit_delete_app":
      result = await apiRequest("DELETE", `/hosting/app/${args.appId}`);
      break;

    // AI Agent
    case "vibekit_chat":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/agent`, {
        message: args.message,
      });
      break;

    case "vibekit_agent_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/agent/status`);
      break;

    case "vibekit_agent_history": {
      let path = `/hosting/app/${args.appId}/agent/history`;
      if (args.limit) {
        path += `?limit=${args.limit}`;
      } else {
        path += "?limit=20";
      }
      result = await apiRequest("GET", path);
      break;
    }

    // Database
    case "vibekit_enable_database":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/database`);
      break;

    case "vibekit_database_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/database`);
      break;

    case "vibekit_db_schema":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/database/schema`);
      break;

    case "vibekit_db_query":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/database/query`, {
        sql: args.sql,
      });
      break;

    case "vibekit_db_table": {
      let path = `/hosting/app/${args.appId}/database/tables/${args.table}`;
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.offset) params.set("offset", String(args.offset));
      if (params.toString()) path += `?${params.toString()}`;
      result = await apiRequest("GET", path);
      break;
    }

    // Deploys
    case "vibekit_list_deploys": {
      let path = `/hosting/app/${args.appId}/deploys`;
      if (args.limit) path += `?limit=${args.limit}`;
      result = await apiRequest("GET", path);
      break;
    }

    case "vibekit_rollback_deploy":
      result = await apiRequest(
        "POST",
        `/hosting/app/${args.appId}/deploys/${args.deployId}/rollback`
      );
      break;

    // QA
    case "vibekit_run_qa":
      result = await apiRequest("POST", `/hosting/app/${args.appId}/qa`);
      break;

    case "vibekit_qa_status":
      result = await apiRequest("GET", `/hosting/app/${args.appId}/qa`);
      break;

    // Tasks (existing)
    case "vibekit_submit_task":
      result = await apiRequest("POST", "/task", {
        task: args.task,
        repo: args.repo,
        branch: args.branch,
        deploy: args.deploy ?? true,
        callbackUrl: args.callbackUrl,
      });
      break;

    case "vibekit_get_task":
      result = await apiRequest("GET", `/task/${args.taskId}`);
      break;

    case "vibekit_cancel_task":
      result = await apiRequest("DELETE", `/task/${args.taskId}`);
      break;

    case "vibekit_list_tasks": {
      let path = "/tasks";
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.status) params.set("status", String(args.status));
      if (params.toString()) path += `?${params.toString()}`;
      result = await apiRequest("GET", path);
      break;
    }

    case "vibekit_wait_for_task": {
      const taskId = args.taskId as string;
      const timeout = ((args.timeoutSeconds as number) || 300) * 1000;
      const start = Date.now();
      
      while (Date.now() - start < timeout) {
        result = await apiRequest("GET", `/task/${taskId}`);
        if (!result.ok) break;
        
        const task = result.data as { status: string };
        if (task.status === "completed" || task.status === "failed") {
          break;
        }
        
        await new Promise((r) => setTimeout(r, 5000));
      }
      
      if (!result!) {
        result = { ok: false, error: "Timeout waiting for task" };
      }
      break;
    }

    case "vibekit_create_schedule":
      result = await apiRequest("POST", "/schedule", {
        task: args.task,
        repo: args.repo,
        cron: args.cron,
        name: args.name,
      });
      break;

    case "vibekit_list_schedules":
      result = await apiRequest("GET", "/schedules");
      break;

    case "vibekit_delete_schedule":
      result = await apiRequest("DELETE", `/schedule/${args.scheduleId}`);
      break;

    // Account
    case "vibekit_account":
      result = await apiRequest("GET", "/account");
      break;

    case "vibekit_list_skills": {
      try {
        // Check cache
        if (skillsCache && Date.now() - skillsCache.fetchedAt < CACHE_TTL) {
          let skills = (skillsCache.manifest as { skills: Array<{ tags?: string[] }> }).skills;
          if (args.tag) {
            skills = skills.filter((s) => s.tags?.includes(args.tag as string));
          }
          result = { ok: true, data: { skills } };
          break;
        }

        // Fetch manifest
        const res = await fetch(`${SKILLS_REGISTRY}/skills.json`);
        if (!res.ok) {
          result = { ok: false, error: `Failed to fetch skills: ${res.status}` };
          break;
        }
        const manifest = await res.json();
        skillsCache = { manifest, fetchedAt: Date.now() };

        let skills = manifest.skills;
        if (args.tag) {
          skills = skills.filter((s: { tags?: string[] }) => s.tags?.includes(args.tag as string));
        }
        result = { ok: true, data: { skills, count: skills.length } };
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
      break;
    }

    case "vibekit_get_skill": {
      try {
        const id = args.id as string;
        if (!id) {
          result = { ok: false, error: "Skill ID is required" };
          break;
        }

        const res = await fetch(`${SKILLS_REGISTRY}/skills/${id}/SKILL.md`);
        if (!res.ok) {
          result = { ok: false, error: `Skill '${id}' not found (${res.status})` };
          break;
        }

        const content = await res.text();
        result = { ok: true, data: { id, content } };
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
      break;
    }

    default:
      result = { ok: false, error: `Unknown tool: ${name}` };
  }

  const text = result.ok
    ? JSON.stringify(result.data, null, 2)
    : `Error: ${result.error}`;

  return { content: [{ type: "text", text }] };
}

// Main server setup
const server = new Server(
  {
    name: "vibekit-mcp",
    version: "0.7.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, (args || {}) as Record<string, unknown>);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeKit MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});