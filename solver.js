// 原芯裁切排样求解器 —— 纯函数，不触碰 IO，保证同输入同输出（编号稳定）。
//
// 模型约定（单位统一为 mm，允许小数）：
// - 每段原芯两端各损失 endLoss（端头损耗），可用区间为 [endLoss, length - endLoss]。
// - 裂隙与污染区间合并为缺陷区间，从可用区间中扣除后得到若干“可用窗口”；
//   切片必须完整落在某一个窗口内，不可跨越缺陷区间。
// - 同一窗口内相邻两片之间消耗一个锯缝 kerf；窗口边缘不额外计锯缝。
// - 切片先按最小长度排入；若窗口剩余余料大于 0 且小于 minRemnant（最短余料），
//   则按放置逆序把切片在其长度范围内加长以吸收废料；吸收不完的余料计为废料。
// - 余料 ≥ minRemnant 视为可再用余料，不计废料。
// - 废料 = 用到段的端头损耗 + 用到段的缺陷长度 + 锯缝总长 + 不可用余料。
// - 切割次数 = 切片数 + 用到的原芯段数（每个用到的段计一次修头切）。
//
// 优化目标（字典序，前者优先）：
//   1. 有效切片数最多；2. 已排切片优先级之和最大；3. 废料最少；
//   4. 切割次数最少；5. 放置签名（按编号）字典序最小 —— 保证同分方案输出稳定。
// 必切（required）切片为硬约束：任何一个必切片排不下即整体不可行，返回冲突列表。

const EPS = 1e-6;
const NODE_CAP = 200000; // 搜索节点上限：超出后返回当前最优（遍历顺序固定，结果仍确定）

export function round3(x) {
  return Math.round(x * 1000) / 1000;
}

// 把任意 JSON 录入归一化为内部结构（非法数值先保留 NaN，交给 validate 报错）。
export function normalizeInputs(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  return {
    params: {
      kerf: num(src.params && src.params.kerf),
      endLoss: num(src.params && src.params.endLoss),
      minRemnant: num(src.params && src.params.minRemnant),
    },
    segments: Array.isArray(src.segments)
      ? src.segments.map((seg) => ({
          id: String((seg && seg.id) ?? "").trim(),
          length: num(seg && seg.length),
          defects: Array.isArray(seg && seg.defects)
            ? seg.defects.map((d) => ({
                start: num(d && d.start),
                end: num(d && d.end),
                kind: d && d.kind === "污染" ? "污染" : "裂隙",
              }))
            : [],
        }))
      : [],
    sliceSpecs: Array.isArray(src.sliceSpecs)
      ? src.sliceSpecs.map((s) => ({
          id: String((s && s.id) ?? "").trim(),
          minLen: num(s && s.minLen),
          maxLen: num(s && s.maxLen),
          methods: Array.isArray(s && s.methods)
            ? s.methods.map((m) => String(m).trim()).filter(Boolean)
            : [],
          priority: Number.isFinite(s && s.priority) ? Math.max(0, Number(s.priority)) : 0,
          required: (s && s.required) === true,
        }))
      : [],
  };
}

// 录入校验，返回错误文案数组（空数组 = 合法）。
export function validateInputs(input) {
  const errors = [];
  const { params, segments, sliceSpecs } = input;
  for (const [key, label] of [["kerf", "锯缝"], ["endLoss", "端头损耗"], ["minRemnant", "最短余料"]]) {
    if (!(params[key] >= 0)) errors.push(`参数「${label}」必须为非负数字`);
  }
  const segIds = new Set();
  for (const seg of segments) {
    if (!seg.id) errors.push("存在未编号的原芯段");
    else if (segIds.has(seg.id)) errors.push(`原芯段编号重复：${seg.id}`);
    else segIds.add(seg.id);
    if (!(seg.length > 0)) errors.push(`原芯段 ${seg.id || "?"} 长度必须为正数`);
    for (const d of seg.defects) {
      if (!(d.start >= 0) || !(d.end > d.start) || !(Number.isFinite(seg.length) && d.end <= seg.length)) {
        errors.push(`原芯段 ${seg.id || "?"} 的${d.kind}区间 [${d.start}, ${d.end}] 非法（需在 0 到段长之间且起点小于终点）`);
      }
    }
  }
  const sliceIds = new Set();
  for (const s of sliceSpecs) {
    if (!s.id) errors.push("存在未编号的切片");
    else if (sliceIds.has(s.id)) errors.push(`切片编号重复：${s.id}`);
    else sliceIds.add(s.id);
    if (!(s.minLen > 0)) errors.push(`切片 ${s.id || "?"} 最小长度必须为正数`);
    else if (!(s.maxLen >= s.minLen)) errors.push(`切片 ${s.id || "?"} 长度范围非法（最大长度需 ≥ 最小长度）`);
    if (!s.methods.length) errors.push(`切片 ${s.id || "?"} 缺少允许方法`);
  }
  return errors;
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter(([a, b]) => b - a > EPS).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// 由段与参数计算可用窗口及每段固定损耗（端头损耗 + 落在可用区内的缺陷长度）。
export function computeWindows(segments, params) {
  const windows = [];
  const segs = [];
  for (const seg of segments) {
    const usableStart = Math.min(params.endLoss, seg.length);
    const usableEnd = Math.max(usableStart, seg.length - params.endLoss);
    const merged = mergeIntervals((seg.defects || []).map((d) => [d.start, d.end]));
    let defectWaste = 0;
    for (const [a, b] of merged) {
      defectWaste += Math.max(0, Math.min(b, usableEnd) - Math.max(a, usableStart));
    }
    const endLossWaste = seg.length - (usableEnd - usableStart);
    const clipped = merged
      .map(([a, b]) => [Math.max(a, usableStart), Math.min(b, usableEnd)])
      .filter(([a, b]) => b - a > EPS);
    const segWindows = [];
    let cursor = usableStart;
    const push = (s, e) => {
      if (e - s > EPS) segWindows.push({ start: round3(s), end: round3(e) });
    };
    for (const [a, b] of clipped) {
      push(cursor, a);
      cursor = Math.max(cursor, b);
    }
    push(cursor, usableEnd);
    segWindows.forEach((w, index) => {
      windows.push({ segmentId: seg.id, index, start: w.start, end: w.end, length: round3(w.end - w.start) });
    });
    segs.push({
      id: seg.id,
      length: seg.length,
      usableStart: round3(usableStart),
      usableEnd: round3(usableEnd),
      defects: (seg.defects || []).map((d) => ({ start: d.start, end: d.end, kind: d.kind })),
      endLossWaste: round3(endLossWaste),
      defectWaste: round3(defectWaste),
      fixedWaste: round3(endLossWaste + defectWaste),
      windows: segWindows,
    });
  }
  return { windows, segs };
}

function cmpSlice(a, b) {
  // 必切优先，其次优先级高优先，最后按编号升序 —— 遍历顺序固定，保证结果确定。
  if (a.required !== b.required) return a.required ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function better(a, b) {
  if (a.count !== b.count) return a.count > b.count;
  if (a.prio !== b.prio) return a.prio > b.prio;
  if (Math.abs(a.waste - b.waste) > 1e-9) return a.waste < b.waste;
  if (a.cuts !== b.cuts) return a.cuts < b.cuts;
  return a.sig < b.sig; // 同分按编号签名取字典序最小，输出稳定
}

// 把一个完整放置（叶子节点）物化为方案：切片加长吸废料、坐标、余料、废料、签名。
function buildSolution(state, windows, segById, params, count, prio) {
  const placements = [];
  const remnantsByWindow = new Map();
  let kerfTotal = 0;
  let remnantWaste = 0;
  let remnantUsable = 0;
  const usedSegs = new Set();
  for (let w = 0; w < windows.length; w++) {
    const st = state[w];
    if (!st.count) continue;
    const win = windows[w];
    usedSegs.add(win.segmentId);
    kerfTotal += params.kerf * (st.count - 1);
    let leftover = win.length - st.used;
    const lens = st.slices.map((s) => s.minLen);
    if (leftover > EPS && leftover < params.minRemnant - EPS) {
      // 余料不够“最短余料”即为废料：按放置逆序加长切片尽量吸收
      for (let k = lens.length - 1; k >= 0 && leftover > EPS; k--) {
        const grow = Math.min(st.slices[k].maxLen - lens[k], leftover);
        lens[k] += grow;
        leftover -= grow;
      }
    }
    const remnant = Math.max(0, leftover);
    const usable = remnant >= params.minRemnant - EPS;
    if (usable) remnantUsable += remnant;
    else remnantWaste += remnant;
    let cursor = win.start;
    st.slices.forEach((s, k) => {
      placements.push({
        sliceId: s.id,
        segmentId: win.segmentId,
        windowIndex: win.index,
        start: round3(cursor),
        end: round3(cursor + lens[k]),
        length: round3(lens[k]),
        method: s.methods[0],
        required: s.required,
        priority: s.priority,
      });
      cursor += lens[k] + params.kerf;
    });
    const lastEnd = placements[placements.length - 1].end;
    if (win.end - lastEnd > EPS) {
      remnantsByWindow.set(w, { start: lastEnd, end: win.end, usable });
    }
  }
  let fixed = 0;
  for (const id of usedSegs) fixed += segById.get(id).fixedWaste;
  const waste = fixed + kerfTotal + remnantWaste;
  const cuts = count + usedSegs.size;
  const sig = placements.map((p) => `${p.sliceId}@${p.segmentId}#${p.windowIndex}:${p.start}`).join("|");
  return {
    count,
    prio,
    waste: round3(waste),
    cuts,
    sig,
    placements,
    remnantsByWindow,
    kerfTotal: round3(kerfTotal),
    remnantWaste: round3(remnantWaste),
    remnantUsable: round3(remnantUsable),
    usedSegments: [...usedSegs].sort(),
  };
}

// 主入口：返回 { ok:true, plan, conflicts:[] } 或 { ok:false, stage, errors|conflicts }。
export function solveLayout(rawInput) {
  const input = normalizeInputs(rawInput);
  const errors = validateInputs(input);
  if (errors.length) return { ok: false, stage: "validation", errors };

  const { params, segments, sliceSpecs } = input;
  const { windows, segs } = computeWindows(segments, params);
  const segById = new Map(segs.map((s) => [s.id, s]));
  const slices = sliceSpecs.map((s) => ({ ...s })).sort(cmpSlice);

  const state = windows.map(() => ({ used: 0, slack: 0, count: 0, slices: [] }));
  const suffixPrio = new Array(slices.length + 1).fill(0);
  for (let i = slices.length - 1; i >= 0; i--) suffixPrio[i] = suffixPrio[i + 1] + slices[i].priority;

  let best = null;
  let nodes = 0;
  let budgetHit = false;

  // 记忆化：同一 (已决切片数, 各窗口已用量/剩余可加长余量/片数) 状态下，
  // 已耗废料与剩余子问题完全相同；若已有不劣的 (片数, 优先级) 到达过，直接剪枝。
  const memo = new Map();
  const usedSegs = new Set();
  let runWaste = 0; // 已确定的废料下界：用到段的固定损耗 + 已耗锯缝（余料废料只增不减）

  function dfs(i, count, prio) {
    const remaining = slices.length - i;
    if (best && count + remaining < best.count) return;
    if (best && count + remaining === best.count && prio + suffixPrio[i] < best.prio) return;
    // 废料剪枝：数量与优先级最多打平时，废料下界已超过当前最优即无需继续
    if (best && count + remaining === best.count && prio + suffixPrio[i] === best.prio && runWaste > best.waste + 1e-9) return;
    if (i === slices.length) {
      const sol = buildSolution(state, windows, segById, params, count, prio);
      if (!best || better(sol, best)) best = sol;
      return;
    }
    if (++nodes > NODE_CAP) {
      budgetHit = true;
      return;
    }
    let key = String(i);
    for (let w = 0; w < state.length; w++) {
      key += "|" + Math.round(state[w].used * 1000) + "," + Math.round(state[w].slack * 1000) + "," + state[w].count;
    }
    const prev = memo.get(key);
    if (prev && prev.count >= count && prev.prio >= prio) return;
    memo.set(key, { count, prio });
    const s = slices[i];
    const seen = new Set();
    const cands = [];
    for (let w = 0; w < windows.length; w++) {
      const win = windows[w];
      const st = state[w];
      const extra = (st.count > 0 ? params.kerf : 0) + s.minLen;
      if (st.used + extra > win.length + EPS) continue;
      // 同段内剩余容量与已放片数相同的窗口互为等价，只试第一个（编号稳定）
      const wkey = win.segmentId + "|" + Math.round((win.length - st.used) * 1000) + "|" + st.count;
      if (seen.has(wkey)) continue;
      seen.add(wkey);
      cands.push({ w, left: win.length - st.used - extra, fresh: usedSegs.has(win.segmentId) ? 0 : 1 });
    }
    // 已用段优先、窗口内最佳适配优先：更快收敛到低废料方案（最终输出由签名决胜，与探索顺序无关）
    cands.sort((a, b) => a.fresh - b.fresh || a.left - b.left || a.w - b.w);
    for (const { w } of cands) {
      const win = windows[w];
      const st = state[w];
      const extra = (st.count > 0 ? params.kerf : 0) + s.minLen;
      const addedSeg = st.count === 0 && !usedSegs.has(win.segmentId);
      const addedWaste = (addedSeg ? segById.get(win.segmentId).fixedWaste : 0) + (st.count > 0 ? params.kerf : 0);
      if (addedSeg) usedSegs.add(win.segmentId);
      runWaste += addedWaste;
      st.used += extra;
      st.slack += s.maxLen - s.minLen;
      st.count++;
      st.slices.push(s);
      dfs(i + 1, count + 1, prio + s.priority);
      st.slices.pop();
      st.count--;
      st.slack -= s.maxLen - s.minLen;
      st.used -= extra;
      runWaste -= addedWaste;
      if (addedSeg) usedSegs.delete(win.segmentId);
      if (budgetHit) return;
    }
    if (!s.required) dfs(i + 1, count, prio); // 必切片没有“跳过”分支
  }
  dfs(0, 0, 0);

  if (!best) {
    const conflicts = [];
    if (!windows.length) conflicts.push("所有原芯段均无可用窗口（端头损耗或缺陷区间过大）");
    const maxWin = windows.reduce((m, w) => Math.max(m, w.length), 0);
    for (const s of slices.filter((x) => x.required)) {
      if (s.minLen > maxWin + EPS) {
        conflicts.push(`必切切片 ${s.id} 最小长度 ${s.minLen}mm 超过所有可用窗口（最大 ${round3(maxWin)}mm）`);
      }
    }
    if (!conflicts.length) conflicts.push("必切切片无法全部排入：可用窗口总容量不足");
    return { ok: false, stage: "infeasible", conflicts };
  }

  const placedIds = new Set(best.placements.map((p) => p.sliceId));
  const maxWin = windows.reduce((m, w) => Math.max(m, w.length), 0);
  const unplaced = slices
    .filter((s) => !placedIds.has(s.id))
    .map((s) => ({
      id: s.id,
      reason: s.minLen > maxWin + EPS ? `最小长度 ${s.minLen}mm 超过所有可用窗口（最大 ${round3(maxWin)}mm）` : "可用窗口容量不足，未排入",
    }));

  const planSegments = segs.map((sg, si) => {
    const segWindows = windows
      .map((w, wi) => ({ ...w, wi }))
      .filter((w) => w.segmentId === sg.id)
      .map((w) => ({
        start: w.start,
        end: w.end,
        remnant: best.remnantsByWindow.get(w.wi) || null,
      }));
    return {
      id: sg.id,
      length: sg.length,
      usableStart: sg.usableStart,
      usableEnd: sg.usableEnd,
      defects: sg.defects,
      endLossWaste: sg.endLossWaste,
      defectWaste: sg.defectWaste,
      used: best.usedSegments.includes(sg.id),
      windows: segWindows,
      placements: best.placements.filter((p) => p.segmentId === sg.id),
    };
  });

  const plan = {
    objective: {
      placed: best.count,
      prioritySum: best.prio,
      waste: best.waste,
      cuts: best.cuts,
      kerfLoss: best.kerfTotal,
      remnantWaste: best.remnantWaste,
      remnantUsable: best.remnantUsable,
    },
    params: { ...params },
    segments: planSegments,
    unplaced,
    notes: budgetHit ? ["搜索达到节点上限，输出当前最优方案"] : [],
  };
  return { ok: true, plan, conflicts: [] };
}
