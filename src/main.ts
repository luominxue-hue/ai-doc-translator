import { invoke } from "@tauri-apps/api/core";

let BASE = "";
let currentTaskId: string | null = null;
let currentBlockId: string | null = null;

async function getBaseUrl() {
  const v = await invoke<string | null>("get_backend_base_url");
  if (!v) throw new Error("backend not ready");
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
  $(id).textContent = v;
}

async function main() {
  await getBaseUrl();
  setText("settingsHint", `鍚庣宸茶繛鎺ワ細${BASE}`);

  $("saveSettings").onclick = async () => {
    try {
      const baseUrl = $("baseUrl").value.trim();
      const apiKey = $("apiKey").value.trim();
      const model = $("model").value.trim();
      const out = await apiPostJson("/api/settings", { base_url: baseUrl, api_key: apiKey, model });
      setText("settingsHint", JSON.stringify(out, null, 2));
    } catch (e: any) {
      setText("settingsHint", String(e));
    }
  };

  $("createTask").onclick = async () => {
    try {
      const f: File | undefined = $("file").files?.[0];
      if (!f) throw new Error("璇烽€夋嫨 .docx 鏂囦欢");
      const direction = $("direction").value;

      const form = new FormData();
      form.append("file", f);
      form.append("direction", direction);

      const r = await fetch(`${BASE}/api/tasks`, { method: "POST", body: form });
      if (!r.ok) throw new Error(await r.text());
      const out = await r.json();
      currentTaskId = out.task_id;
      setText("taskHint", `浠诲姟宸插垱寤猴細${currentTaskId}\nblocks: ${out.blocks}`);
    } catch (e: any) {
      setText("taskHint", String(e));
    }
  };

  $("runTranslate").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("璇峰厛鍒涘缓浠诲姟");
      const out = await apiPostJson(`/api/tasks/${currentTaskId}/run_translate`, {});
      setText("progressHint", JSON.stringify(out, null, 2));
    } catch (e: any) {
      setText("progressHint", String(e));
    }
  };

  $("refreshTask").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("璇峰厛鍒涘缓浠诲姟");
      const out = await apiGet(`/api/tasks/${currentTaskId}`);
      setText("progressHint", JSON.stringify(out, null, 2));
    } catch (e: any) {
      setText("progressHint", String(e));
    }
  };

  $("loadBlocks").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("璇峰厛鍒涘缓浠诲姟");
      const blocks = await apiGet(`/api/tasks/${currentTaskId}/blocks?offset=0&limit=5000`);
      const list = $("blockList");
      list.innerHTML = "";
      for (const b of blocks) {
        const div = document.createElement("div");
        div.className = "item";
        div.textContent = `#${b.order_no} [${b.status}] ${b.source_text.slice(0, 50)}`;
        div.onclick = () => {
          currentBlockId = b.id;
          $("srcText").value = b.source_text || "";
          $("dstText").value = b.translated_text || "";
          setText("blockHint", `宸查€変腑锛?{b.id}`);
        };
        list.appendChild(div);
      }
      setText("blockHint", `宸插姞杞?blocks: ${blocks.length}`);
    } catch (e: any) {
      setText("blockHint", String(e));
    }
  };

  $("saveBlock").onclick = async () => {
    try {
      if (!currentTaskId || !currentBlockId) throw new Error("璇峰厛閫夋嫨涓€涓潡");
      const translated_text = $("dstText").value;
      const out = await apiPatchJson(`/api/tasks/${currentTaskId}/blocks/${currentBlockId}`, { translated_text });
      setText("blockHint", JSON.stringify(out, null, 2));
    } catch (e: any) {
      setText("blockHint", String(e));
    }
  };

  $("exportDocx").onclick = async () => {
    try {
      if (!currentTaskId) throw new Error("璇峰厛鍒涘缓浠诲姟");
      const r = await fetch(`${BASE}/api/tasks/${currentTaskId}/export`);
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "translated.docx";
      a.click();
      URL.revokeObjectURL(a.href);
      setText("progressHint", "宸茶Е鍙戜笅杞斤細translated.docx锛堝湪榛樿涓嬭浇鐩綍锛?);
    } catch (e: any) {
      setText("progressHint", String(e));
    }
  };
}

main().catch(e => {
  setText("settingsHint", String(e));
});
