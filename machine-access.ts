import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CUSTOM_TYPE = "machine-access";
const RESTRICTED_TOOLS = new Set(["read", "write", "edit", "bash"]);

const SYSTEM_NOTE = [
  "Machine access is a user-controlled flag. You cannot change it.",
  "When machine access is off, the tools read, write, edit, and bash are unavailable.",
  "The user can toggle it at any time with Ctrl+; — before they send a message or while you are looping.",
  "Watch for developer messages tagged [state_changed] for the current machine_access value and tool list.",
  "Do not assume the previous state still applies. If you need tools you do not have, ask the user to toggle and send a follow-up.",
].join(" ");

interface State {
  machineAccess: boolean;
  toolsBeforeRestrict?: string[];
}

export default function (pi: ExtensionAPI) {
  let machineAccess = true;
  let toolsBeforeRestrict: string[] | undefined;
  let lastAnnounced: boolean | undefined;

  function persist() {
    pi.appendEntry<State>(CUSTOM_TYPE, { machineAccess, toolsBeforeRestrict });
  }

  function applyTools() {
    if (machineAccess) {
      if (toolsBeforeRestrict) {
        pi.setActiveTools(toolsBeforeRestrict);
        toolsBeforeRestrict = undefined;
      }
      return;
    }
    if (!toolsBeforeRestrict) {
      toolsBeforeRestrict = pi.getActiveTools();
    }
    pi.setActiveTools(toolsBeforeRestrict.filter((name) => !RESTRICTED_TOOLS.has(name)));
  }

  function updateStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus(
      "machine-access",
      machineAccess
        ? ctx.ui.theme.fg("success", "machine on")
        : ctx.ui.theme.fg("warning", "machine off"),
    );
  }

  function toggle(ctx: ExtensionContext) {
    machineAccess = !machineAccess;
    applyTools();
    persist();
    updateStatus(ctx);
  }

  function stateLine() {
    const tools = pi.getActiveTools();
    const toolList = tools.length > 0 ? tools.join(",") : "none";
    return `[state_changed] machine_access=${machineAccess ? "ON" : "OFF"} tools=${toolList} as of this message`;
  }

  function injectStateChanged(payload: unknown): unknown {
    if (!payload || typeof payload !== "object") return payload;
    const p = { ...(payload as Record<string, unknown>) };
    const line = stateLine();

    for (const key of ["input", "messages"] as const) {
      const list = p[key];
      if (!Array.isArray(list)) continue;
      const next = list.slice();
      let lastUser = -1;
      for (let i = 0; i < next.length; i++) {
        const item = next[i];
        if (item && typeof item === "object" && (item as { role?: unknown }).role === "user") {
          lastUser = i;
        }
      }
      next.splice(lastUser >= 0 ? lastUser + 1 : next.length, 0, {
        role: key === "input" ? "developer" : "system",
        content: line,
      });
      p[key] = next;
    }
    return p;
  }

  pi.on("session_start", (_event, ctx) => {
    machineAccess = true;
    toolsBeforeRestrict = undefined;
    lastAnnounced = undefined;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
      const data = entry.data as State | undefined;
      if (typeof data?.machineAccess !== "boolean") continue;
      machineAccess = data.machineAccess;
      toolsBeforeRestrict = data.toolsBeforeRestrict;
    }

    applyTools();
    updateStatus(ctx);
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${SYSTEM_NOTE}`,
  }));

  pi.on("before_provider_request", (event) => {
    if (lastAnnounced === undefined && machineAccess) {
      lastAnnounced = true;
      return;
    }
    if (lastAnnounced === machineAccess) return;
    const payload = injectStateChanged(event.payload);
    lastAnnounced = machineAccess;
    return payload;
  });

  pi.registerShortcut("ctrl+;", {
    description: "Toggle machine access (read/write/edit/bash)",
    handler: (ctx) => toggle(ctx),
  });

  pi.on("tool_call", (event) => {
    if (machineAccess) return;
    if (!RESTRICTED_TOOLS.has(event.toolName)) return;
    return {
      block: true,
      reason: "Machine access is off. Press Ctrl+; then send a follow-up to use tools.",
    };
  });
}
