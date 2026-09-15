// 排样页面模板（/nesting）。客户端脚本一律用字符串拼接，避免与外层模板字符串冲突。
export const nestingPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>原芯裁切排样 · 岩芯样本切片实验室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#242822; --muted:#687062; --line:#d7ddd1; --accent:#526f43; --danger:#b0483e; --warn:#9a6b1f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:18px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:16px; }
    h1 { margin:0; font-size:24px; } h2 { margin:0 0 10px; font-size:17px; } h3 { margin:0; font-size:15px; }
    nav { display:flex; gap:10px; align-items:center; } a { color:var(--accent); font-weight:700; text-decoration:none; }
    main { display:grid; grid-template-columns:430px 1fr; gap:20px; padding:20px 28px; align-items:start; }
    .panel,form { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px; margin-bottom:14px; }
    label { display:block; margin:8px 0 4px; color:var(--muted); font-size:12px; }
    input { width:100%; border:1px solid var(--line); border-radius:6px; padding:7px 8px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 13px; font-weight:700; cursor:pointer; }
    button.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
    button.tiny { padding:4px 8px; font-size:12px; background:#eef1ea; color:var(--ink); border:1px solid var(--line); }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
    .row { display:grid; gap:6px; align-items:end; padding:8px 0; border-top:1px dashed var(--line); }
    .row.seg { grid-template-columns:1fr 70px 1.6fr 34px; }
    .row.slice { grid-template-columns:1fr 58px 58px 1fr 56px 46px 34px; }
    .row .del { padding:6px 0; text-align:center; }
    .hint { color:var(--muted); font-size:12px; margin:2px 0 0; }
    .stats { display:grid; grid-template-columns:repeat(6,1fr); gap:8px; margin-bottom:12px; }
    .stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:10px; } .stat strong { display:block; font-size:20px; }
    .stat span { color:var(--muted); font-size:12px; }
    .seg { background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:10px; overflow-x:auto; }
    .meta { color:var(--muted); font-size:13px; margin-bottom:6px; }
    svg text { font:11px Arial,"PingFang SC",sans-serif; fill:#242822; } svg text.r { fill:#687062; font-size:10px; }
    .box { border-radius:8px; padding:12px 14px; margin-bottom:12px; font-size:14px; }
    .box.err { background:#fbeeec; border:1px solid #e3b6b1; color:var(--danger); }
    .box.warn { background:#fbf5e8; border:1px solid #e6d3a8; color:var(--warn); }
    .box.ok { background:#eef4e8; border:1px solid #c3d4b0; color:var(--accent); }
    .chip { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 9px; font-size:12px; margin:2px 4px 2px 0; background:#fff; }
    .chip.cur { background:var(--accent); color:#fff; border-color:var(--accent); }
    .vbtn { margin:0 6px 6px 0; }
    .legend span { margin-right:12px; font-size:12px; color:var(--muted); }
    .sw { display:inline-block; width:12px; height:12px; border-radius:3px; vertical-align:-2px; margin-right:4px; }
    #banner { display:none; }
    @media (max-width:1000px){ main{grid-template-columns:1fr;padding:14px;} .stats{grid-template-columns:1fr 1fr 1fr;} header{display:block;} }
  </style>
</head>
<body>
  <svg width="0" height="0" style="position:absolute"><defs>
    <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="#e4e7e1"></rect><line x1="0" y1="0" x2="0" y2="6" stroke="#b7beb0" stroke-width="2"></line>
    </pattern>
  </defs></svg>
  <header>
    <div><h1>原芯裁切排样</h1><div class="meta">录入原芯缺陷与切片需求，自动排出切割方案 · 目标：先最多切片，再最少废料与切割</div></div>
    <nav><a href="/">← 切片实验室（旧入口）</a><button id="reload" type="button">刷新</button></nav>
  </header>
  <main>
    <section>
      <form id="paramsForm" onsubmit="return false">
        <h2>切割参数（mm）</h2>
        <label>锯缝宽度</label><input id="pKerf" type="number" step="any" min="0">
        <label>端头损耗（每端）</label><input id="pEndLoss" type="number" step="any" min="0">
        <label>最短余料（小于此长度即废料）</label><input id="pMinRemnant" type="number" step="any" min="0">
      </form>
      <div class="panel">
        <h2>原芯段</h2>
        <div id="segRows"></div>
        <p class="hint">缺陷区间格式：<code>起点-终点 裂隙；起点-终点 污染</code>，可多条用分号分隔。</p>
        <button id="addSeg" type="button" class="ghost">添加原芯段</button>
      </div>
      <div class="panel">
        <h2>待制切片</h2>
        <div id="sliceRows"></div>
        <p class="hint">方法用逗号分隔；勾选「必切」的切片必须保留，排不下则本次排样失败并给出冲突。</p>
        <button id="addSlice" type="button" class="ghost">添加切片</button>
      </div>
      <div class="toolbar">
        <button id="saveInputs" type="button">保存录入</button>
        <button id="relayout" type="button">重新排样</button>
      </div>
      <div id="msg"></div>
    </section>
    <section>
      <div id="banner" class="box warn"></div>
      <div class="stats" id="planStats"></div>
      <div id="conflicts"></div>
      <div class="panel">
        <h2>排样图</h2>
        <div class="legend">
          <span><i class="sw" style="background:#7ba05b"></i>切片</span>
          <span><i class="sw" style="background:#8f958a"></i>锯缝</span>
          <span><i class="sw" style="background:#c05b4d"></i>裂隙</span>
          <span><i class="sw" style="background:#df9150"></i>污染</span>
          <span><i class="sw" style="background:repeating-linear-gradient(45deg,#e4e7e1,#e4e7e1 2px,#b7beb0 2px,#b7beb0 4px)"></i>端头损耗</span>
          <span><i class="sw" style="background:#dde8cf"></i>可再用余料</span>
          <span><i class="sw" style="background:#efd9d9"></i>废料</span>
        </div>
        <div id="diagram"></div>
      </div>
      <div id="unplaced"></div>
      <div class="panel"><h2>版本</h2><div id="versions"></div></div>
    </section>
  </main>
  <script>
    var state = null, viewing = null, dirty = false, lastConflicts = [];
    var segs = [], specs = [], params = { kerf: 0, endLoss: 0, minRemnant: 0 };

    function api(path, options) {
      return fetch(path, options && options.body ? Object.assign({}, options, { headers: { "Content-Type": "application/json" } }) : options)
        .then(function(res){ return res.json().then(function(data){ if (!res.ok) { var e = new Error(data.error || "请求失败"); e.status = res.status; e.data = data; throw e; } return data; }); });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]; }); }
    function fmtDefects(defs) { return (defs || []).map(function(d){ return d.start + "-" + d.end + " " + d.kind; }).join("；"); }
    function parseDefects(text) {
      var out = [];
      String(text || "").split(/[;；]/).forEach(function(part){
        var m = part.match(/(\\d+(?:\\.\\d+)?)\\s*[-~–—]\\s*(\\d+(?:\\.\\d+)?)\\s*(裂隙|污染)?/);
        if (m) out.push({ start: Number(m[1]), end: Number(m[2]), kind: m[3] === "污染" ? "污染" : "裂隙" });
      });
      return out;
    }
    function parseMethods(text) { return String(text || "").split(/[,，、;；\\s]+/).map(function(s){ return s.trim(); }).filter(Boolean); }

    function syncFromState() {
      params = { kerf: state.params.kerf, endLoss: state.params.endLoss, minRemnant: state.params.minRemnant };
      segs = state.segments.map(function(sg){ return { id: sg.id, length: sg.length, defectsText: fmtDefects(sg.defects) }; });
      specs = state.sliceSpecs.map(function(s){ return { id: s.id, minLen: s.minLen, maxLen: s.maxLen, methodsText: s.methods.join("，"), priority: s.priority, required: s.required }; });
    }

    function renderEditors() {
      document.querySelector("#pKerf").value = params.kerf;
      document.querySelector("#pEndLoss").value = params.endLoss;
      document.querySelector("#pMinRemnant").value = params.minRemnant;
      document.querySelector("#segRows").innerHTML = segs.map(function(sg, i){
        return '<div class="row seg">' +
          '<div><label>编号</label><input data-seg="id" data-i="' + i + '" value="' + esc(sg.id) + '"></div>' +
          '<div><label>长度</label><input data-seg="length" data-i="' + i + '" type="number" step="any" value="' + esc(sg.length) + '"></div>' +
          '<div><label>裂隙 / 污染区间</label><input data-seg="defectsText" data-i="' + i + '" value="' + esc(sg.defectsText) + '" placeholder="如 100-140 裂隙；300-330 污染"></div>' +
          '<button type="button" class="tiny del" data-del-seg="' + i + '">删</button></div>';
      }).join("");
      document.querySelector("#sliceRows").innerHTML = specs.map(function(s, i){
        return '<div class="row slice">' +
          '<div><label>编号</label><input data-sp="id" data-i="' + i + '" value="' + esc(s.id) + '"></div>' +
          '<div><label>最小</label><input data-sp="minLen" data-i="' + i + '" type="number" step="any" value="' + esc(s.minLen) + '"></div>' +
          '<div><label>最大</label><input data-sp="maxLen" data-i="' + i + '" type="number" step="any" value="' + esc(s.maxLen) + '"></div>' +
          '<div><label>允许方法</label><input data-sp="methodsText" data-i="' + i + '" value="' + esc(s.methodsText) + '" placeholder="金刚石锯，线锯"></div>' +
          '<div><label>优先级</label><input data-sp="priority" data-i="' + i + '" type="number" step="1" min="0" value="' + esc(s.priority) + '"></div>' +
          '<div><label>必切</label><input data-sp="required" data-i="' + i + '" type="checkbox"' + (s.required ? " checked" : "") + '></div>' +
          '<button type="button" class="tiny del" data-del-slice="' + i + '">删</button></div>';
      }).join("");
      document.querySelectorAll("[data-seg]").forEach(function(el){
        el.oninput = function(){ segs[Number(el.dataset.i)][el.dataset.seg] = el.value; dirty = true; };
      });
      document.querySelectorAll("[data-sp]").forEach(function(el){
        el.oninput = function(){ specs[Number(el.dataset.i)][el.dataset.sp] = el.type === "checkbox" ? el.checked : el.value; dirty = true; };
      });
      document.querySelectorAll("[data-del-seg]").forEach(function(btn){ btn.onclick = function(){ segs.splice(Number(btn.dataset.delSeg), 1); dirty = true; renderEditors(); }; });
      document.querySelectorAll("[data-del-slice]").forEach(function(btn){ btn.onclick = function(){ specs.splice(Number(btn.dataset.delSlice), 1); dirty = true; renderEditors(); }; });
    }

    function collectInputs() {
      return {
        params: { kerf: Number(document.querySelector("#pKerf").value), endLoss: Number(document.querySelector("#pEndLoss").value), minRemnant: Number(document.querySelector("#pMinRemnant").value) },
        segments: segs.map(function(sg){ return { id: String(sg.id).trim(), length: Number(sg.length), defects: parseDefects(sg.defectsText) }; }),
        sliceSpecs: specs.map(function(s){ return { id: String(s.id).trim(), minLen: Number(s.minLen), maxLen: Number(s.maxLen), methods: parseMethods(s.methodsText), priority: Number(s.priority) || 0, required: !!s.required }; })
      };
    }

    function rect(x, y, w, h, fill, stroke, title) {
      return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + h + '" fill="' + fill + '"' + (stroke && stroke !== "none" ? ' stroke="' + stroke + '"' : "") + '>' + (title ? "<title>" + esc(title) + "</title>" : "") + "</rect>";
    }

    function segSvg(seg, scale) {
      var y = 16, h = 26, W = Math.max(40, seg.length * scale), H = 50;
      var parts = ['<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">'];
      parts.push(rect(0, y, W, h, "#f7f8f5", "#d7ddd1"));
      parts.push(rect(seg.usableStart * scale, y, (seg.usableEnd - seg.usableStart) * scale, h, "#edf3e6", "none"));
      parts.push(rect(0, y, seg.usableStart * scale, h, "url(#hatch)", "none", "端头损耗"));
      parts.push(rect(seg.usableEnd * scale, y, (seg.length - seg.usableEnd) * scale, h, "url(#hatch)", "none", "端头损耗"));
      seg.defects.forEach(function(d){
        parts.push(rect(d.start * scale, y, (d.end - d.start) * scale, h, d.kind === "污染" ? "#df9150" : "#c05b4d", "none", d.kind + " " + d.start + "-" + d.end + "mm"));
      });
      seg.windows.forEach(function(w){
        if (w.remnant) parts.push(rect(w.remnant.start * scale, y, (w.remnant.end - w.remnant.start) * scale, h, w.remnant.usable ? "#dde8cf" : "#efd9d9", "none", (w.remnant.usable ? "可再用余料 " : "废料 ") + (w.remnant.end - w.remnant.start) + "mm"));
      });
      var ps = seg.placements.slice().sort(function(a, b){ return a.start - b.start; });
      for (var i = 1; i < ps.length; i++) {
        if (ps[i].windowIndex === ps[i - 1].windowIndex) parts.push(rect(ps[i - 1].end * scale, y, Math.max(1, (ps[i].start - ps[i - 1].end) * scale), h, "#8f958a", "none", "锯缝"));
      }
      ps.forEach(function(p){
        parts.push(rect(p.start * scale, y, Math.max(1.5, p.length * scale), h, p.required ? "#5d8a48" : "#7ba05b", "#4c6b38", p.sliceId + " · " + p.length + "mm · " + p.method + (p.required ? " · 必切" : "")));
        if (p.length * scale >= 30) parts.push('<text x="' + ((p.start + p.length / 2) * scale) + '" y="' + (y + 17) + '" text-anchor="middle" fill="#fff">' + esc(p.sliceId) + "</text>");
      });
      parts.push('<text x="0" y="11" class="r">0</text>');
      parts.push('<text x="' + W + '" y="11" text-anchor="end" class="r">' + seg.length + "mm</text>");
      parts.push("</svg>");
      return parts.join("");
    }

    function renderPlan(plan, label) {
      var stats = document.querySelector("#planStats");
      if (!plan) { stats.innerHTML = '<div class="stat"><span>状态</span><strong>尚未排样</strong></div>'; document.querySelector("#diagram").innerHTML = ""; document.querySelector("#unplaced").innerHTML = ""; return; }
      var o = plan.objective;
      stats.innerHTML =
        '<div class="stat"><span>' + esc(label || "当前版本") + '</span><strong>v' + esc(plan.versionLabel || "") + "</strong></div>" +
        '<div class="stat"><span>有效切片</span><strong>' + o.placed + "</strong></div>" +
        '<div class="stat"><span>总优先级</span><strong>' + o.prioritySum + "</strong></div>" +
        '<div class="stat"><span>废料 mm</span><strong>' + o.waste + "</strong></div>" +
        '<div class="stat"><span>切割次数</span><strong>' + o.cuts + "</strong></div>" +
        '<div class="stat"><span>可再用余料 mm</span><strong>' + o.remnantUsable + "</strong></div>";
      var maxLen = plan.segments.reduce(function(m, s){ return Math.max(m, s.length); }, 1);
      var scale = Math.min(1.6, 920 / maxLen);
      document.querySelector("#diagram").innerHTML = plan.segments.map(function(seg){
        return '<div class="seg"><div class="meta"><b>' + esc(seg.id) + "</b> · 全长 " + seg.length + "mm · 端头损耗 " + seg.endLossWaste + "mm · 缺陷 " + seg.defectWaste + "mm" + (seg.used ? "" : " · 未使用") + "</div>" + segSvg(seg, scale) + "</div>";
      }).join("");
      document.querySelector("#unplaced").innerHTML = plan.unplaced.length
        ? '<div class="box warn">未排入切片：' + plan.unplaced.map(function(u){ return '<span class="chip">' + esc(u.id) + "（" + esc(u.reason) + "）</span>"; }).join("") + "</div>"
        : "";
      if (plan.notes && plan.notes.length) document.querySelector("#unplaced").innerHTML += '<div class="box warn">' + plan.notes.map(esc).join("；") + "</div>";
    }

    function renderConflicts() {
      document.querySelector("#conflicts").innerHTML = lastConflicts.length
        ? '<div class="box err"><b>冲突：</b><ul style="margin:6px 0 0;padding-left:18px">' + lastConflicts.map(function(c){ return "<li>" + esc(c) + "</li>"; }).join("") + "</ul></div>"
        : "";
    }

    function renderVersions() {
      var el = document.querySelector("#versions");
      if (!state.versions.length) { el.innerHTML = '<span class="meta">暂无版本</span>'; return; }
      el.innerHTML = state.versions.map(function(v){
        var cur = viewing ? viewing.version === v.version : v.version === state.currentVersion;
        return '<button type="button" class="tiny vbtn' + (cur ? " chip cur" : "") + '" data-ver="' + v.version + '">v' + v.version + " · 切片 " + v.objective.placed + " · 废料 " + v.objective.waste + " · " + new Date(v.at).toLocaleString() + "</button>";
      }).join("");
      el.querySelectorAll("[data-ver]").forEach(function(btn){
        btn.onclick = function(){
          api("/api/nesting/versions/" + btn.dataset.ver).then(function(rec){
            viewing = rec;
            renderAll();
          }).catch(showError);
        };
      });
    }

    function renderBanner() {
      var el = document.querySelector("#banner");
      if (viewing) {
        el.style.display = "block";
        el.innerHTML = "正在查看历史版本 v" + viewing.version + "（" + new Date(viewing.at).toLocaleString() + "） <button type='button' class='tiny' id='backCur'>返回当前版本</button>";
        document.querySelector("#backCur").onclick = function(){ viewing = null; renderAll(); };
      } else el.style.display = "none";
    }

    function renderAll() {
      renderEditors();
      renderConflicts();
      var plan = viewing ? viewing.plan : state.plan;
      if (plan) plan.versionLabel = viewing ? viewing.version : state.currentVersion;
      renderBanner();
      renderPlan(plan, viewing ? "历史版本" : "当前版本");
      renderVersions();
    }

    function showError(e) {
      var msg = document.querySelector("#msg");
      if (e.status === 409) {
        msg.innerHTML = '<div class="box warn">版本冲突：其他终端已完成重排（当前 v' + esc(e.data.currentVersion) + "），已为你刷新。</div>";
        load();
        return;
      }
      if (e.status === 422 && e.data) {
        lastConflicts = e.data.conflicts || e.data.details || [e.data.error];
        renderConflicts();
        msg.innerHTML = '<div class="box err">' + esc(e.data.error === "layout_infeasible" ? "排样失败：必切切片无法全部排入，未生成任何部分方案。" : "录入不合法，未保存。") + "</div>";
        return;
      }
      msg.innerHTML = '<div class="box err">' + esc(e.message || "请求失败") + "</div>";
    }

    function load() {
      return api("/api/nesting/state").then(function(s){
        state = s;
        viewing = null;
        if (!dirty) syncFromState();
        renderAll();
      });
    }

    document.querySelector("#reload").onclick = function(){ load(); };
    document.querySelector("#addSeg").onclick = function(){ segs.push({ id: "SEG-" + String(segs.length + 1).padStart(2, "0"), length: 300, defectsText: "" }); dirty = true; renderEditors(); };
    document.querySelector("#addSlice").onclick = function(){ specs.push({ id: "P-" + String(specs.length + 1).padStart(2, "0"), minLen: 40, maxLen: 60, methodsText: "金刚石锯", priority: 0, required: false }); dirty = true; renderEditors(); };
    ["#pKerf", "#pEndLoss", "#pMinRemnant"].forEach(function(sel){ document.querySelector(sel).oninput = function(){ dirty = true; }; });
    document.querySelector("#saveInputs").onclick = function(){
      api("/api/nesting/inputs", { method: "PUT", body: JSON.stringify(collectInputs()) }).then(function(){
        dirty = false;
        lastConflicts = [];
        document.querySelector("#msg").innerHTML = '<div class="box ok">录入已保存。</div>';
        return load();
      }).catch(showError);
    };
    document.querySelector("#relayout").onclick = function(){
      api("/api/nesting/relayout", { method: "POST", body: JSON.stringify({ baseVersion: state.currentVersion }) }).then(function(res){
        lastConflicts = [];
        document.querySelector("#msg").innerHTML = '<div class="box ok">已生成新版本 v' + res.version + "。</div>";
        return load();
      }).catch(showError);
    };
    load().catch(showError);
  </script>
</body>
</html>`;
