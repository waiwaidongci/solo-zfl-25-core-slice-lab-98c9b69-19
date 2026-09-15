// 原芯裁切排样实测：启动真实服务，通过 HTTP 验证
// 缺陷不可跨越、边界（锯缝/端头损耗/最短余料/加长吸废料）、并列最优编号稳定、
// 必切保留、并发仅一次成功、失败回滚不留部分方案、重启不丢、旧入口保留。
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function startServer(dataDir) {
  const child = spawn(process.execPath, [join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("服务启动超时")), 10000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) => reject(new Error(`服务提前退出 code=${code}`)));
  });
  return child;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.on("exit", resolve));
}

async function api(path, options = {}) {
  const res = await fetch(BASE + path, options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const getState = async () => (await api("/api/nesting/state")).data;
const putInputs = (inputs) => api("/api/nesting/inputs", { method: "PUT", body: JSON.stringify(inputs) });
const relayout = (baseVersion) => api("/api/nesting/relayout", { method: "POST", body: JSON.stringify({ baseVersion }) });
async function relayoutCurrent() {
  const v = (await getState()).currentVersion;
  return relayout(v);
}
const base = (over = {}) => ({ params: { kerf: 0, endLoss: 0, minRemnant: 0 }, segments: [], sliceSpecs: [], ...over });
const seg = (id, length, defects = []) => ({ id, length, defects });
const slice = (id, minLen, maxLen, over = {}) => ({ id, minLen, maxLen, methods: ["金刚石锯"], priority: 0, required: false, ...over });

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "nesting-test-"));
  let child = await startServer(dataDir);
  try {
    // 0. 首次启动：种子数据自动排出版本 1
    {
      const state = await getState();
      assert.equal(state.currentVersion, 1, "种子数据应自动排出版本 1");
      assert.equal(state.plan.objective.placed, 4, "种子方案应排入 4 片");
      assert.equal(state.versions.length, 1);
      ok("启动后种子数据自动排版（v1，4 片）");
    }

    // 1. 缺陷区间不可跨越
    {
      await putInputs(base({
        segments: [seg("S1", 200, [{ start: 90, end: 110, kind: "裂隙" }])],
        sliceSpecs: [slice("A", 50, 50, { required: true }), slice("B", 50, 50), slice("C", 95, 95)],
      }));
      const res = await relayoutCurrent();
      assert.equal(res.status, 200);
      const plan = res.data.plan;
      assert.equal(plan.objective.placed, 2, "两个 50mm 切片应分别落入缺陷两侧窗口");
      for (const p of plan.segments[0].placements) {
        assert.ok(p.end <= 90 || p.start >= 110, `切片 ${p.sliceId} 不得跨越缺陷 [90,110]，实际 [${p.start},${p.end}]`);
      }
      assert.deepEqual(plan.unplaced.map((u) => u.id), ["C"]);
      assert.match(plan.unplaced[0].reason, /超过所有可用窗口/);
      ok("缺陷区间不可跨越（95mm 切片无法跨越裂隙，判为未排入）");
    }

    // 2a. 边界：锯缝累积 + 恰好放满
    {
      await putInputs(base({
        params: { kerf: 2, endLoss: 0, minRemnant: 0 },
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("A", 49, 49), slice("B", 49, 49)],
      }));
      const res = await relayoutCurrent();
      const ps = res.data.plan.segments[0].placements;
      assert.equal(ps.length, 2, "49+2+49=100 应恰好放下两片");
      assert.deepEqual([ps[0].start, ps[0].end, ps[1].start, ps[1].end], [0, 49, 51, 100]);
      assert.equal(res.data.plan.objective.kerfLoss, 2);
      ok("边界：锯缝累积后恰好放满（49+2+49=100）");
    }

    // 2b. 边界：端头损耗
    {
      await putInputs(base({
        params: { kerf: 0, endLoss: 10, minRemnant: 0 },
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("A", 85, 85), slice("B", 80, 80)],
      }));
      const res = await relayoutCurrent();
      const plan = res.data.plan;
      assert.equal(plan.objective.placed, 1);
      const p = plan.segments[0].placements[0];
      assert.equal(p.sliceId, "B");
      assert.deepEqual([p.start, p.end], [10, 90], "切片应落在 [端头损耗, 长度-端头损耗] 内");
      assert.deepEqual(plan.unplaced.map((u) => u.id), ["A"]);
      ok("边界：端头损耗后可用区间恰为 80mm");
    }

    // 2c. 边界：最短余料（≥ 为可再用，< 为废料）
    {
      await putInputs(base({
        params: { kerf: 0, endLoss: 0, minRemnant: 40 },
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("A", 60, 60)],
      }));
      let res = await relayoutCurrent();
      assert.equal(res.data.plan.objective.remnantUsable, 40, "余料 40 ≥ 最短余料 40 应为可再用");
      assert.equal(res.data.plan.objective.waste, 0);

      await putInputs(base({
        params: { kerf: 0, endLoss: 0, minRemnant: 41 },
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("A", 60, 60)],
      }));
      res = await relayoutCurrent();
      assert.equal(res.data.plan.objective.remnantUsable, 0);
      assert.equal(res.data.plan.objective.waste, 40, "余料 40 < 最短余料 41 且无法加长吸收，应计废料");
      ok("边界：最短余料 40 可再用 / 41 判废料");
    }

    // 2d. 边界：切片加长吸收不足最短余料的废料
    {
      await putInputs(base({
        params: { kerf: 0, endLoss: 0, minRemnant: 45 },
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("A", 60, 75)],
      }));
      const res = await relayoutCurrent();
      const p = res.data.plan.segments[0].placements[0];
      assert.equal(p.length, 75, "切片应在长度范围内加长以吸收废料");
      assert.equal(res.data.plan.objective.waste, 25, "吸收不完的 25mm 计废料");
      ok("边界：切片加长吸收废料（60→75，废 25）");
    }

    // 3. 并列最优：同分方案按编号稳定输出，且重复排样结果一致
    {
      const inputs = base({
        segments: [seg("SEG-A", 120), seg("SEG-B", 120)],
        sliceSpecs: [slice("S-02", 60, 60, { priority: 1 }), slice("S-01", 60, 60, { priority: 1 })],
      });
      await putInputs(inputs);
      const r1 = await relayoutCurrent();
      const p1 = r1.data.plan.segments.flatMap((s) => s.placements);
      assert.equal(p1.length, 2);
      assert.ok(p1.every((p) => p.segmentId === "SEG-A"), "对称同分方案应稳定选择编号较小的 SEG-A");
      assert.deepEqual(p1.map((p) => [p.sliceId, p.start]), [["S-01", 0], ["S-02", 60]], "同窗口内按编号顺序放置");
      const r2 = await relayoutCurrent();
      const p2 = r2.data.plan.segments.flatMap((s) => s.placements);
      assert.deepEqual(p2, p1, "相同录入重复排样应得到完全相同的方案");
      ok("并列最优：同分方案按编号稳定输出，重复排样一致");
    }

    // 4. 必切保留 + 优先级取舍
    {
      await putInputs(base({
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("R", 60, 60, { required: true }), slice("O", 60, 60, { priority: 9 })],
      }));
      let res = await relayoutCurrent();
      assert.deepEqual(res.data.plan.segments[0].placements.map((p) => p.sliceId), ["R"], "容量只够一片时必切片必须保留");
      assert.deepEqual(res.data.plan.unplaced.map((u) => u.id), ["O"]);

      await putInputs(base({
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("O1", 60, 60, { priority: 1 }), slice("O2", 60, 60, { priority: 9 })],
      }));
      res = await relayoutCurrent();
      assert.deepEqual(res.data.plan.segments[0].placements.map((p) => p.sliceId), ["O2"], "同等数量下优先级高者入排");
      ok("必切保留；同数量下高优先级优先");
    }

    // 5. 并发重排：仅一次成功，失败不留部分方案
    {
      const before = await getState();
      const [r1, r2] = await Promise.all([relayout(before.currentVersion), relayout(before.currentVersion)]);
      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, [200, 409], "并发重排应恰好一次 200 一次 409");
      const loser = r1.status === 409 ? r1 : r2;
      assert.equal(loser.data.error, "version_conflict");
      const after = await getState();
      assert.equal(after.currentVersion, before.currentVersion + 1, "版本号只应前进 1");
      assert.equal(after.versions.length, before.versions.length + 1, "只应新增一个版本");
      ok("并发重排仅一次成功（200+409），版本只前进 1");
    }

    // 6a. 回滚：必切片排不下 → 排样失败，状态不变
    {
      await putInputs(base({
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("R", 500, 500, { required: true }), slice("O", 40, 40)],
      }));
      const before = await getState();
      const res = await relayoutCurrent();
      assert.equal(res.status, 422);
      assert.equal(res.data.error, "layout_infeasible");
      assert.ok(res.data.conflicts.some((c) => c.includes("R")), "冲突应指明必切片 R");
      const after = await getState();
      assert.equal(after.currentVersion, before.currentVersion, "失败后版本号不变");
      assert.equal(after.versions.length, before.versions.length, "失败后不留部分方案（无新版本）");
      assert.deepEqual(after.plan, before.plan, "失败后当前方案保持原样");
      ok("回滚：排样失败不留部分方案，版本与方案保持原样");
    }

    // 6b. 回滚：非法录入 → 拒绝保存，录入不变
    {
      const before = await getState();
      const res = await putInputs(base({
        segments: [seg("S1", 100)],
        sliceSpecs: [slice("BAD", 80, 50)],
      }));
      assert.equal(res.status, 422);
      assert.equal(res.data.error, "invalid_inputs");
      assert.ok(res.data.details.some((d) => d.includes("BAD")));
      const after = await getState();
      assert.deepEqual(after.sliceSpecs, before.sliceSpecs, "非法录入不应覆盖现有录入");
      ok("回滚：非法录入被拒绝且原录入不变");
    }

    // 7. 重启不丢 + 旧入口保留
    {
      const before = await getState();
      await stopServer(child);
      child = await startServer(dataDir);
      const after = await getState();
      assert.equal(after.currentVersion, before.currentVersion, "重启后版本号不丢");
      assert.deepEqual(after.versions, before.versions, "重启后版本列表不丢");
      assert.deepEqual(after.segments, before.segments, "重启后录入不丢");
      const v1 = await api("/api/nesting/versions/1");
      assert.equal(v1.status, 200);
      assert.ok(v1.data.plan.objective, "历史版本可回看");

      const home = await fetch(BASE + "/");
      assert.equal(home.status, 200);
      assert.match(await home.text(), /岩芯样本切片实验室/, "旧入口页面保留");
      const samples = await api("/api/samples");
      assert.equal(samples.status, 200);
      assert.ok(Array.isArray(samples.data), "旧样本 API 保留");
      const nesting = await fetch(BASE + "/nesting");
      assert.equal(nesting.status, 200);
      assert.match(await nesting.text(), /原芯裁切排样/, "排样页面可访问");
      ok("重启不丢（版本/录入/方案），旧入口与新页面均可用");
    }

    console.log(`\n全部 ${passed} 组实测通过`);
  } finally {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("\n实测失败：", error.message);
  process.exit(1);
});
