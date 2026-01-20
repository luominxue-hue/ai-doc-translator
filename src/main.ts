import { invoke } from "@tauri-apps/api/core";

let BASE = "";
let currentTaskId: string | null = null;
let currentBlockId: string | null = null;

async function getBaseUrl() {
  const v = await invoke<string | null>("get_backend_base_url");
  if (!v) throw new Error("Backend not ready.");
  BASE = v;
}

async function apiGet(path: string) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiPostJson(path: string, body: any) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiPatchJson(path: string, body: any) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function $(id: string) {
  return document.getElementById(id) as any;
}

function setText(id: string, v: string) {
  const el = $(id);
  if (el) el.textContent = v;
}

function safeJson(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function main() {
  await getBaseUrl();
  setText("settingsHint", `Backend connected: ${BASE}`);

  // Save settings (base_url, api_key, model)
  $("saveSettings").onclick = async () => {
    try {
      const base_url = $("baseUrl").value.trim();
      const api_key = $("apiKey").value.trim();
      const model = $("model").value.trim();

      if (!base_url || !api_key || !model) {
        throw new Error("base_url / api_key / model are required.");
      }

      const out = await apiPostJson("/api/settings", { base_url, api_key, model });
      setText("settingsHint", safeJson(out));
    } catch (e: any) {
      setText("settingsHint", String(e?.message || e));
    }
  };

  // Create task (upload DOCX)
  $("createTask").onclick = async () => {
    try {
      const f: File | undefined = $("file").files?.[0];
      if (!f) throw new Error("Please select a .docx file.");
      const direction = $("direction").value;

      const form = new FormData();
      form.append("file", f);
      form.append("direction", direction);

      const r = await fetch(`${BASE}/api/tasks`, { method: "POST", body: form });
      if (!r.ok) throw new Error(await r.text());
      const out = await r.json();

      currentTaskId = out.task_id;
      currentBlockId = null;

      setText("taskHint", `Task created: ${currentTaskId}\nBlocks: ${out.blocks}`);
      setText("progressHint", "Ready.");
    } catch (e: any) {
      setText("taskHint", String(e?.message || e));
    }
  };

  // Start/continue translation
  $("runTranslate").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("Please create a task first.");
      const out = await apiPostJson(`/api/tasks/${currentTaskId}/run_translate`, {});
      setText("progressHint", safeJson(out));
    } catch (e: any) {
      setText("progressHint", String(e?.message || e));
    }
  };

  // Refresh task progress
  $("refreshTask").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("Please create a task first.");
      const out = await apiGet(`/api/tasks/${currentTaskId}`);
      setText("progressHint", safeJson(out));
    } catch (e: any) {
      setText("progressHint", String(e?.message || e));
    }
  };

  // Load blocks for review/edit
  $("loadBlocks").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("Please create a task first.");

      const blocks = await apiGet(`/api/tasks/${currentTaskId}/blocks?offset=0&limit=5000`);
      const list = $("blockList");
      list.innerHTML = "";

      for (const b of blocks) {
        const div = document.createElement("div");
        div.className = "item";
        const src = (b.source_text || "").replace(/\s+/g, " ").slice(0, 60);
        div.textContent = `#${b.order_no} [${b.status}] ${src}`;
        div.onclick = () => {
          currentBlockId = b.id;
          $("srcText").value = b.source_text || "";
          $("dstText").value = b.translated_text || "";
          setText("blockHint", `Selected block: ${b.id}`);
        };
        list.appendChild(div);
      }

      setText("blockHint", `Loaded blocks: ${blocks.length}`);
    } catch (e: any) {
      setText("blockHint", String(e?.message || e));
    }
  };

  // Save edited translation for one block
  $("saveBlock").onclick = async () => {
    try {
      if (!currentTaskId || !currentBlockId) throw new Error("Please select a block first.");
      const translated_text = $("dstText").value;

      const out = await apiPatchJson(`/api/tasks/${currentTaskId}/blocks/${currentBlockId}`, { translated_text });
      setText("blockHint", safeJson(out));
    } catch (e: any) {
      setText("blockHint", String(e?.message || e));
    }
  };

  // Export translated DOCX (download)
  $("exportDocx").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("Please create a task first.");

      const r = await fetch(`${BASE}/api/tasks/${currentTaskId}/export`);
      if (!r.ok) throw new Error(await r.text());

      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "translated.docx";
      a.click();
      URL.revokeObjectURL(a.href);

      setText("progressHint", "Download started: translated.docx (check your default Downloads folder).");
    } catch (e: any) {
      setText("progressHint", String(e?.message || e));
    }
  };
}

main().catch((e) => {
  setText("settingsHint", `Fatal error: ${String((e as any)?.message || e)}`);
});
