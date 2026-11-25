/* =========================================================================
   WorkBuddy 积分消耗可视化大屏 · 前端脚本
   数据来源：用户导入的 CSV（或演示数据）
   字段约定：时间, 产品, 积分消耗, 模型, 使用端
   所有统计均在浏览器内实时计算，不依赖后端。
   ========================================================================= */

// 优先使用内嵌的演示数据（demo_data.js 会定义 window.DEMO_CSV 常量），
// 这样即使双击 index.html（file:// 协议）也能正常显示，无需本地服务。
// 若用户通过「导入数据」上传自己的 CSV，则走浏览器文件读取，同样不受 file:// 限制。
const DEMO_CSV = 'data/usage_demo.csv';

const charts = {};
const $ = id => document.getElementById(id);
const fmt = (v, n = 1) => (v === null || v === undefined || isNaN(v)) ? '-' : Number(v).toFixed(n);

const AXIS = '#6b8296';
const GRID_LINE = 'rgba(99,153,208,.13)';
const TOOLTIP = {
  backgroundColor: 'rgba(255,255,255,.97)',
  borderColor: 'rgba(99,153,208,.35)',
  borderWidth: 1,
  textStyle: { color: '#33475b', fontSize: 12 },
  extraCssText: 'box-shadow:0 6px 24px rgba(80,110,140,.25);border-radius:4px;'
};

const MODEL_COLORS = {
  'deepseek-v4-pro': '#5b9bd5',
  'deepseek-v4.1-flash': '#3bc1c8',
  'glm-5.3-flash': '#5fb878',
  'hy4-flash-free': '#f4c56a',
  'wb-lite': '#9c88d8',
  'hy4-preview': '#e88a86',
  'hy3': '#7fc4e8'
};
const CLIENT_COLORS = { 'WorkBuddy': '#5b9bd5', 'app_cloud': '#5fb878' };

function baseChart(id) {
  if (!charts[id]) charts[id] = echarts.init($(id), null, { renderer: 'canvas' });
  return charts[id];
}

/* ---------------- CSV 解析 ---------------- */
function parseCSV(text) {
  // 去掉 BOM
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error('CSV 内容为空或缺少表头');
  const header = lines[0].split(',').map(h => h.trim());
  const idx = {
    time: header.findIndex(h => h.includes('时间') || h === 'time' || h === 'Time'),
    cost: header.findIndex(h => h.includes('积分') || h.includes('消耗') || h === 'cost'),
    model: header.findIndex(h => h.includes('模型') || h === 'model'),
    client: header.findIndex(h => h.includes('端') || h.includes('客户端') || h === 'client'),
  };
  if (idx.time < 0 || idx.cost < 0) {
    throw new Error('CSV 需包含「时间」和「积分消耗」两列（当前表头：' + header.join(', ') + '）');
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length <= Math.max(idx.time, idx.cost)) continue;
    const timeStr = (cells[idx.time] || '').trim();
    const costStr = (cells[idx.cost] || '').trim();
    if (!timeStr) continue;
    const cost = parseFloat(costStr);
    if (isNaN(cost)) continue;
    rows.push({
      time: timeStr,
      date: timeStr.slice(0, 10),
      hour: parseInt(timeStr.slice(11, 13), 10) || 0,
      cost: cost,
      model: (cells[idx.model] || '未知').trim() || '未知',
      client: (cells[idx.client] || '未知').trim() || '未知',
    });
  }
  if (rows.length === 0) throw new Error('未解析到有效数据行');
  return rows;
}

/* ---------------- 聚合统计 ---------------- */
function aggregate(rows) {
  const total = rows.reduce((s, r) => s + r.cost, 0);
  const paid = rows.filter(r => r.cost > 0);
  const count = paid.length;
  const days = new Set(rows.map(r => r.date));
  const dailyAvg = total / days.size;
  const peak = paid.reduce((m, r) => (r.cost > m.cost ? r : m), paid[0] || { cost: 0 });

  // 每日趋势
  const dayMap = {};
  const dayCountMap = {};
  rows.forEach(r => {
    dayMap[r.date] = (dayMap[r.date] || 0) + r.cost;
    dayCountMap[r.date] = (dayCountMap[r.date] || 0) + 1;
  });
  const sortedDates = Object.keys(dayMap).sort();
  const trend = sortedDates.map(d => ({
    date: d, cost: dayMap[d], count: dayCountMap[d]
  }));

  // 模型统计
  const modelMap = {};
  rows.forEach(r => { modelMap[r.model] = (modelMap[r.model] || 0) + r.cost; });
  const modelData = Object.entries(modelMap)
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost);

  // 使用端统计
  const clientMap = {};
  const clientCountMap = {};
  rows.forEach(r => {
    clientMap[r.client] = (clientMap[r.client] || 0) + r.cost;
    clientCountMap[r.client] = (clientCountMap[r.client] || 0) + 1;
  });
  const clientData = Object.entries(clientMap).map(([name, cost]) => ({
    name, cost, count: clientCountMap[name]
  }));

  // 单笔消耗区间分布（只统计非零）
  const buckets = [
    { label: '0~0.1', lo: 0, hi: 0.1 },
    { label: '0.1~1', lo: 0.1, hi: 1 },
    { label: '1~5', lo: 1, hi: 5 },
    { label: '5~30', lo: 5, hi: 30 },
    { label: '30~100', lo: 30, hi: 100 },
    { label: '100+', lo: 100, hi: Infinity },
  ];
  const bucketData = buckets.map(b => ({
    label: b.label,
    count: paid.filter(r => r.cost >= b.lo && r.cost < b.hi).length
  }));

  // 时段热力（小时 0-23 的消耗均值）
  const hourMap = {};
  const hourCnt = {};
  rows.forEach(r => {
    hourMap[r.hour] = (hourMap[r.hour] || 0) + r.cost;
    hourCnt[r.hour] = (hourCnt[r.hour] || 0) + 1;
  });
  const hourData = [];
  for (let h = 0; h < 24; h++) {
    hourData.push({
      hour: h,
      avg: hourCnt[h] ? hourMap[h] / hourCnt[h] : 0,
      total: hourMap[h] || 0
    });
  }

  // 日历热力数据
  const calendarData = rows.map(r => [r.date, r.cost]);

  return {
    total, count, dailyAvg, peak,
    dayCount: days.size,
    trend, modelData, clientData, bucketData, hourData, calendarData,
    dateRange: [sortedDates[0], sortedDates[sortedDates.length - 1]]
  };
}

/* ---------------- 渲染 ---------------- */
function renderKpi(a) {
  $('k-total').textContent = fmt(a.total, 2);
  $('k-count').textContent = a.count;
  $('k-daily').textContent = fmt(a.dailyAvg, 2);
  $('k-peak').textContent = fmt(a.peak.cost, 2);
  $('k-total-sub').textContent = `${a.dateRange[0]} ~ ${a.dateRange[1]}`;
  $('k-count-sub').textContent = `共 ${a.dayCount} 个活跃日`;
  $('k-daily-sub').textContent = `活跃 ${a.dayCount} 天`;
  $('k-peak-sub').textContent = a.peak.time ? a.peak.time.slice(5, 16) : '';
  $('hd-sub').textContent = `${a.dateRange[0]} ~ ${a.dateRange[1]} · ${a.count} 笔消耗 · 覆盖 ${a.dayCount} 天`;
}

function renderTrend(a) {
  const c = baseChart('c-trend');
  c.setOption({
    grid: { left: 50, right: 56, top: 36, bottom: 28 },
    tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'line' } }, TOOLTIP),
    legend: { data: ['积分消耗', '笔数'], right: 12, top: 4, itemWidth: 14, itemHeight: 8, textStyle: { color: '#5a7590', fontSize: 11 } },
    xAxis: {
      type: 'category', data: a.trend.map(x => x.date.slice(5)), boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(99,153,208,.35)' } }, axisTick: { show: false },
      axisLabel: { color: AXIS, fontSize: 9, interval: 3 }
    },
    yAxis: [
      { type: 'value', name: '积分', nameTextStyle: { color: AXIS, fontSize: 10 }, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: GRID_LINE } } },
      { type: 'value', name: '笔数', nameTextStyle: { color: '#5fb878', fontSize: 10 }, axisLabel: { color: '#5fb878', fontSize: 9 }, splitLine: { show: false } }
    ],
    series: [
      {
        name: '积分消耗', type: 'line', smooth: true, symbol: 'none',
        data: a.trend.map(x => Math.round(x.cost * 100) / 100),
        lineStyle: { width: 2, color: '#4a90c4' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(91,155,213,.30)' }, { offset: 1, color: 'rgba(91,155,213,.02)' }]) }
      },
      {
        name: '笔数', type: 'bar', yAxisIndex: 1, barWidth: 6,
        data: a.trend.map(x => x.count),
        itemStyle: { color: 'rgba(95,184,120,.5)', borderRadius: [2, 2, 0, 0] }
      }
    ]
  }, true);
}

function renderModel(a) {
  const c = baseChart('c-model');
  const data = a.modelData.map(m => ({
    name: m.name, value: Math.round(m.cost * 100) / 100,
    itemStyle: { color: MODEL_COLORS[m.name] || '#b0bec5' }
  }));
  c.setOption({
    tooltip: Object.assign({ trigger: 'item', formatter: p => `<b>${p.name}</b><br/>积分：<b>${p.value}</b>（${p.percent}%）` }, TOOLTIP),
    legend: { bottom: 2, left: 'center', itemWidth: 9, itemHeight: 9, itemGap: 8, icon: 'circle', textStyle: { color: '#5a7590', fontSize: 10 } },
    series: [{
      type: 'pie', radius: ['38%', '62%'], center: ['50%', '44%'],
      itemStyle: { borderColor: '#f3f8fc', borderWidth: 2 },
      label: { color: '#3a5b78', fontSize: 10, formatter: p => `${p.name}\n${p.percent}%` },
      labelLine: { length: 6, length2: 8, lineStyle: { color: 'rgba(120,150,170,.4)' } },
      data
    }]
  }, true);
}

function renderClient(a) {
  const c = baseChart('c-client');
  const names = a.clientData.map(d => d.name);
  c.setOption({
    grid: { left: 50, right: 30, top: 40, bottom: 28 },
    tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, TOOLTIP),
    xAxis: { type: 'category', data: names, axisLine: { lineStyle: { color: 'rgba(99,153,208,.35)' } }, axisTick: { show: false }, axisLabel: { color: '#5a7590', fontSize: 11 } },
    yAxis: [
      { type: 'value', name: '积分', axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: GRID_LINE } } },
      { type: 'value', name: '笔数', axisLabel: { color: '#5fb878', fontSize: 9 }, splitLine: { show: false } }
    ],
    series: [
      {
        name: '积分', type: 'bar', barWidth: 32,
        data: a.clientData.map(d => Math.round(d.cost * 100) / 100),
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#5b9bd5' }, { offset: 1, color: 'rgba(91,155,213,.3)' }]), borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top', color: '#2b4a66', fontSize: 11, fontWeight: 600 }
      },
      {
        name: '笔数', type: 'bar', yAxisIndex: 1, barWidth: 20,
        data: a.clientData.map(d => d.count),
        itemStyle: { color: 'rgba(95,184,120,.65)', borderRadius: [3, 3, 0, 0] }
      }
    ]
  }, true);
}

function renderRank(a) {
  const c = baseChart('c-rank');
  const rows = a.modelData.slice().sort((x, y) => x.cost - y.cost);
  c.setOption({
    grid: { left: 150, right: 56, top: 12, bottom: 24 },
    tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => { const r = rows[p[0].dataIndex]; return `<b>${r.name}</b><br/>积分：<b>${Math.round(r.cost * 100) / 100}</b>`; } }, TOOLTIP),
    xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: GRID_LINE } } },
    yAxis: { type: 'category', data: rows.map(r => r.name), axisLine: { lineStyle: { color: 'rgba(99,153,208,.35)' } }, axisTick: { show: false }, axisLabel: { color: '#5a7590', fontSize: 10 } },
    series: [{
      type: 'bar', barWidth: 14,
      data: rows.map(r => ({
        value: Math.round(r.cost * 100) / 100,
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: (MODEL_COLORS[r.name] || '#5b9bd5') + '88' }, { offset: 1, color: MODEL_COLORS[r.name] || '#5b9bd5' }]), borderRadius: [0, 2, 2, 0] }
      })),
      label: { show: true, position: 'right', color: '#2b4a66', fontSize: 10, fontWeight: 600 }
    }]
  }, true);
}

function renderBucket(a) {
  const c = baseChart('c-bucket');
  c.setOption({
    grid: { left: 46, right: 30, top: 36, bottom: 26 },
    tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' } }, TOOLTIP),
    xAxis: { type: 'category', data: a.bucketData.map(b => b.label), axisLine: { lineStyle: { color: 'rgba(99,153,208,.35)' } }, axisTick: { show: false }, axisLabel: { color: '#5a7590', fontSize: 10 } },
    yAxis: { type: 'value', name: '笔数', axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: GRID_LINE } } },
    series: [{
      type: 'bar', barWidth: 26,
      data: a.bucketData.map(b => b.count),
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#3bc1c8' }, { offset: 1, color: 'rgba(59,193,200,.25)' }]), borderRadius: [3, 3, 0, 0] },
      label: { show: true, position: 'top', color: '#2b4a66', fontSize: 10 }
    }]
  }, true);
}

function renderHour(a) {
  const c = baseChart('c-hour');
  const hours = a.hourData;
  c.setOption({
    grid: { left: 50, right: 56, top: 36, bottom: 28 },
    tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'line' }, formatter: p => { const h = hours[p[0].dataIndex]; return `<b>${h.hour}:00</b><br/>平均消耗：<b>${fmt(h.avg, 2)}</b> 分<br/>总消耗：${fmt(h.total, 2)} 分`; } }, TOOLTIP),
    xAxis: { type: 'category', data: hours.map(h => h.hour + '时'), boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(99,153,208,.35)' } }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 9, interval: 2 } },
    yAxis: { type: 'value', name: '均值分', nameTextStyle: { color: AXIS, fontSize: 10 }, axisLabel: { color: AXIS, fontSize: 9 }, splitLine: { lineStyle: { color: GRID_LINE } } },
    series: [{
      type: 'line', smooth: true, symbol: 'circle', symbolSize: 5,
      data: hours.map(h => Math.round(h.avg * 100) / 100),
      lineStyle: { width: 2, color: '#5fb878' },
      itemStyle: { color: '#5fb878' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(95,184,120,.28)' }, { offset: 1, color: 'rgba(95,184,120,.02)' }]) }
    }]
  }, true);
}

function renderCalendar(a) {
  const c = baseChart('c-calendar');
  const el = $('c-calendar');
  const H = el.clientHeight || 250;
  const topPad = 40, bottomPad = 36;
  const range = [a.dateRange[0], a.dateRange[1]];

  // 聚合每日总消耗
  const daySum = {};
  a.rows.forEach(r => { daySum[r.date] = (daySum[r.date] || 0) + r.cost; });

  const data = Object.entries(daySum).map(([date, cost]) => [date, Math.round(cost * 100) / 100]);

  const maxV = Math.max(...Object.values(daySum));
  c.setOption({
    tooltip: Object.assign({ formatter: p => `<b>${p.value[0]}</b><br/>消耗：<b>${p.value[1]}</b> 分` }, TOOLTIP),
    visualMap: {
      type: 'continuous', min: 0, max: Math.ceil(maxV), orient: 'horizontal', left: 'center', bottom: 2,
      itemWidth: 14, itemHeight: 120, textStyle: { color: '#5a7590', fontSize: 10 },
      inRange: { color: ['#eef6fd', '#b5d4f4', '#5b9bd5', '#2d6fae'] }
    },
    calendar: {
      top: topPad, left: 40, right: 40, bottom: bottomPad,
      range, cellSize: ['auto', 22],
      splitLine: { show: false },
      itemStyle: { color: 'rgba(255,255,255,.7)', borderWidth: 2, borderColor: 'rgba(240,246,251,.95)', borderRadius: 3 },
      dayLabel: { firstDay: 1, nameMap: 'ZH', color: '#6b8296', fontSize: 9 },
      monthLabel: { nameMap: 'ZH', color: '#4a6b85', fontSize: 10 },
      yearLabel: { show: false }
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data }]
  }, true);
}

/* ---------------- 自适应缩放 ---------------- */
const STAGE_W = 1920, STAGE_H = 1080;
function fitStage() {
  const st = document.querySelector('.stage');
  if (!st) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const s = Math.min(vw / STAGE_W, vh / STAGE_H);
  const x = (vw - STAGE_W * s) / 2;
  const y = (vh - STAGE_H * s) / 2;
  st.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(5)})`;
}
window.addEventListener('resize', fitStage);
fitStage();

/* ---------------- 错误提示 ---------------- */
function showError(e) {
  $('err-hint').innerHTML = '数据解析失败，请检查文件格式是否为「时间, 产品, 积分消耗, 模型, 使用端」的 CSV 或 XLSX。<br>支持直接导入 WorkBuddy 导出的积分消耗明细（xlsx / csv）。';
  $('err-detail').textContent = (e && e.message) ? e.message : String(e);
  $('err').classList.add('show');
}
function hideError() { $('err').classList.remove('show'); }

/* ---------------- 主流程 ---------------- */
function render(rows) {
  hideError();
  const a = aggregate(rows);
  a.rows = rows; // 供日历使用
  renderKpi(a);
  renderTrend(a);
  renderModel(a);
  renderClient(a);
  renderRank(a);
  renderBucket(a);
  renderHour(a);
  renderCalendar(a);
  $('refresh-time').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  window.addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()));
}

async function loadCSV(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  return res.text();
}

// 导入按钮
$('btn-import').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const name = (file.name || '').toLowerCase();
    let csvText;
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
      // xlsx 文件 → 解析为二维数组 → 转 CSV → 走统一解析
      const rows = await parseXlsxFile(file);
      if (!rows || rows.length < 2) throw new Error('xlsx 解析结果为空');
      csvText = rowsToCsv(rows);
    } else {
      // csv / xls（文本）直接读文本
      csvText = await file.text();
    }
    render(parseCSV(csvText));
  } catch (err) { showError(err); }
});

// 演示数据按钮
$('btn-demo').addEventListener('click', async () => {
  try {
    render(parseCSV(await getDemoCSV()));
  } catch (err) { showError(err); }
});

// 优先取内嵌数据，失败再尝试 fetch 本地 CSV
async function getDemoCSV() {
  if (typeof window.DEMO_INLINE === 'string' && window.DEMO_INLINE.trim() !== '') {
    return window.DEMO_INLINE;
  }
  return loadCSV(DEMO_CSV);
}

// 启动时自动载入演示数据
window.addEventListener('load', async () => {
  try {
    render(parseCSV(await getDemoCSV()));
  } catch (err) {
    // 演示数据加载失败，提示用户起服务或导入
    showError(new Error('演示数据加载失败，请通过本地服务打开（见 README），或点击「导入数据」上传你的 CSV'));
  }
});
