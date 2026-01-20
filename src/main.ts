import { invoke } from "@tauri-apps/api/core";

let BASE = "";
let currentTaskId: string | null = null;
let currentBlockId: string | null = null;

let pollTaskTimer: number | null = null;
let pollBlocksTimer: number | null = null;

let blocksLoaded = false;
let blocksCache: any[] = [];

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

function setProgress(p: number, status: string) {
  const bar = $("progressBar") as HTMLProgressElement;
  const pct = $("progressPct") as HTMLElement;
  const st = $("progressStatus") as HTMLElement;

  const val = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
  if (bar) bar.value = val;
  if (pct) pct.textContent = `${Math.round(val * 100)}%`;
  if (st) st.textContent = status ? `Status: ${status}` : "";
}

function stopPolling() {
  if (pollTaskTimer) window.clearInterval(pollTaskTimer);
  if (pollBlocksTimer) window.clearInterval(pollBlocksTimer);
  pollTaskTimer = null;
  pollBlocksTimer = null;
}

function startPolling() {
  stopPolling();

  // Poll task every 1s (progress/status)
  pollTaskTimer = window.setInterval(async () => {
    try {
      if (!currentTaskId) return;
      const t = await apiGet(`/api/tasks/${currentTaskId}`);
      setProgress(t.progress ?? 0, t.status ?? "");
      if (t.error) setText("progressHint", `Error: ${t.error}`);

      // auto stop when finished/error
      if (t.status === "finished") {
        // keep one more blocks refresh to show final state
        setTimeout(() => refreshBlocks(false).catch(() => {}), 300);
        stopPolling();
      }
      if (t.status === "error") {
        stopPolling();
      }
    } catch (e: any) {
      // ignore transient errors
    }
  }, 1000);

  // Poll blocks every 2.5s IF user has loaded blocks list
  pollBlocksTimer = window.setInterval(async () => {
    try {
      if (!currentTaskId) return;
      if (!blocksLoaded) return;
      await refreshBlocks(true);
    } catch {
      // ignore
    }
  }, 2500);
}

async function refreshBlocks(keepSelection: boolean) {
  if (!currentTaskId) return;

  const blocks = await apiGet(`/api/tasks/${currentTaskId}/blocks?offset=0&limit=5000`);
  blocksCache = blocks;

  // counts
  const total = blocks.length;
  const done = blocks.filter((b: any) => b.status === "translated" || b.status === "edited").length;
  setText("progressCounts", `Blocks: ${done} / ${total}`);

  // re-render list (simple, OK for ~500 blocks)
  const list = $("blockList") as HTMLElement;
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

  // If a block is selected and user is not typing, auto-refresh its translation text
  if (keepSelection && currentBlockId) {
    const active = document.activeElement;
    const isEditing = active && (active as any).id === "dstText";
    if (!isEditing) {
      const b = blocks.find((x: any) => x.id === currentBlockId);
      if (b) {
        $("srcText").value = b.source_text || "";
        $("dstText").value = b.translated_text || "";
      }
    }
  }
}

async function main() {
  await getBaseUrl();
  setText("settingsHint", `Backend connected: ${BASE}`);
  setProgress(0, "");

  $("saveSettings").onclick = async () => {
    try {
      const base_url = $("baseUrl").value.trim();
      const api_key = $("apiKey").value.trim();
      const model = $("model").value.trim();

      if (!base_url || !api_key || !model) {
        throw new Error("base_url / api_key / model are required.");
      }
      const out = await apiPostJson("/api/settings", { base_url, api_key, model });
      setText("settingsHint", JSON.stringify(out, null, 2));
    } catch (e: any) {
      setText("settingsHint", String(e?.message || e));
    }
  };

  $("createTask").onclick = async () => {
    try {
      const f: File | undefined = $("file").files?.[0];
      if (!f) throw new Error("Please select a .docx file.");
      const direction = $("direction").value;

      // reset UI state
      stopPolling();
      blocksLoaded = false;
      blocksCache = [];
      currentBlockId = null;
      $("blockList").innerHTML = "";
      $("srcText").value = "";
      $("dstText").value = "";
      setText("blockHint", "");
      setText("progressHint", "");
      setText("progressCounts", "");
      setProgress(0, "created");

      const form = new FormData();
      form.append("file", f);
      form.append("direction", direction);

      const r = await fetch(`${BASE}/api/tasks`, { method: "POST", body: form });
      if (!r.ok) throw new Error(await r.text());
      const out = await r.json();

      currentTaskId = out.task_id;
      setText("taskHint", `Task created: ${currentTaskId}\nBlocks: ${out.blocks}`);

      // start polling immediately so user sees progress without clicking anything
      startPolling();
    } catch (e: any) {
      setText("taskHint", String(e?.message || e));
    }
  };

  $("runTranslate").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("Please create a task first.");
      const out = await apiPostJson(`/api/tasks/${currentTaskId}/run_translate`, {});
      setText("progressHint", JSON.stringify(out, null, 2));

      // ensure polling is on
      startPolling();
    } catch (e: any) {
      setText("progressHint", String(e?.message || e));
    }
  };

  $("loadBlocks").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("Please create a task first.");
      blocksLoaded = true;
      await refreshBlocks(false);
      setText("blockHint", `Loaded blocks: ${blocksCache.length}`);
      // polling already running will keep refreshing blocks
      startPolling();
    } catch (e: any) {
      setText("blockHint", String(e?.message || e));
    }
  };

  $("saveBlock").onclick = async () => {
    try {
      if (!currentTaskId || !currentBlockId) throw new Error("Please select a block first.");
      const translated_text = $("dstText").value;
      const out = await apiPatchJson(`/api/tasks/${currentTaskId}/blocks/${currentBlockId}`, { translated_text });
      setText("blockHint", JSON.stringify(out, null, 2));

      // refresh list to show edited status
      if (blocksLoaded) await refreshBlocks(true);
    } catch (e: any) {
      setText("blockHint", String(e?.message || e));
    }
  };

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
