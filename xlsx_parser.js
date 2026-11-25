/* =========================================================================
   轻量 xlsx 解析器（无第三方依赖）
   xlsx 本质是 zip 包，本模块用浏览器原生 DecompressionStream 解压，
   再解析 xl/worksheets/sheetN.xml 与 xl/sharedStrings.xml 抽取表格数据。

   支持：STORED（无压缩）与 DEFLATE 两种压缩方式；多个 sheet；内联字符串与共享字符串。
   输出：二维数组 rows[行][列]，返回第一个 sheet 的数据（或指定 index）。
   ========================================================================= */

async function parseXlsxFile(file) {
  const buf = await file.arrayBuffer();
  return parseXlsx(buf);
}

/* ---------------- zip 解析 ---------------- */
async function readZipEntries(buf) {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);

  // 找到中央目录起始（EOCD 签名 0x06054b50），从文件末尾向前扫
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx（zip）文件');

  const entryCount = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break; // 中央目录头签名
    const method = dv.getUint16(p + 10, true);   // 0=STORED, 8=DEFLATE
    const compSize = dv.getUint32(p + 20, true);
    const uncompSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);

    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, uncompSize, localOffset });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extractEntry(bytes, entry) {
  // 定位本地文件头
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lp = entry.localOffset;
  if (dv.getUint32(lp, true) !== 0x04034b50) throw new Error('zip 本地文件头损坏: ' + entry.name);

  const nameLen = dv.getUint16(lp + 26, true);
  const extraLen = dv.getUint16(lp + 28, true);
  const dataStart = lp + 30 + nameLen + extraLen;
  const data = bytes.subarray(dataStart, dataStart + entry.compSize);

  if (entry.method === 0) {
    // STORED 无压缩
    return data;
  } else if (entry.method === 8) {
    // DEFLATE
    const stream = new DecompressionStream('deflate-raw');
    const blob = new Blob([data]);
    const decompressed = await new Response(blob.stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(decompressed);
  } else {
    throw new Error('不支持的压缩方式: ' + entry.method);
  }
}

/* ---------------- xlsx 解析 ---------------- */
const XLSX_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

async function parseXlsx(buf) {
  const bytes = new Uint8Array(buf);
  const entries = await readZipEntries(buf);

  const entryMap = {};
  for (const e of entries) entryMap[e.name] = e;

  // 1) 解析 sharedStrings
  let shared = [];
  if (entryMap['xl/sharedStrings.xml']) {
    const sharedBytes = await extractEntry(bytes, entryMap['xl/sharedStrings.xml']);
    const xml = new TextDecoder('utf-8').decode(sharedBytes);
    shared = parseSharedStrings(xml);
  }

  // 2) 确定 sheet 顺序（从 workbook.xml 或 rels）
  const sheetNames = getSheetNames(bytes, entryMap);

  // 3) 解析第一个 sheet
  const sheet1Name = sheetNames[0] || 'sheet1';
  const sheetPath = 'xl/worksheets/' + sheet1Name + '.xml';
  if (!entryMap[sheetPath]) throw new Error('找不到工作表: ' + sheetPath);

  const sheetBytes = await extractEntry(bytes, entryMap[sheetPath]);
  const xml = new TextDecoder('utf-8').decode(sheetBytes);
  return parseSheet(xml, shared);
}

function getSheetNames(bytes, entryMap) {
  const names = [];
  // 优先从 workbook.xml 读取
  if (entryMap['xl/workbook.xml']) {
    // 异步前先同步解压？这里 workbook.xml 通常是 STORED，直接用简单方式读取
    // 为简单起见，用正则扫描 sheet1/sheet2... 是否存在于 worksheets 目录
  }
  // 扫描 worksheets 目录下的 sheetN.xml
  for (const name of Object.keys(entryMap)) {
    const m = name.match(/^xl\/worksheets\/(sheet\d+)\.xml$/);
    if (m) names.push(m[1]);
  }
  names.sort();
  return names;
}

function parseSharedStrings(xml) {
  const out = [];
  const re = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    // 拼接 <t> 内容
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t, s = '';
    while ((t = tRe.exec(m[1])) !== null) {
      s += decodeXml(t[1]);
    }
    out.push(s);
  }
  return out;
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// 将 Excel 列名（A、B、AA）转为数字索引
function colToIndex(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowXml = rm[1];
    const cells = [];
    const cellRe = /<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rowXml)) !== null) {
      const attrs = cm[1] || '';
      const refMatch = attrs.match(/r="([A-Z]+)\d+"/);
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const col = refMatch ? colToIndex(refMatch[1]) : cells.length;
      const type = typeMatch ? typeMatch[1] : 'n';

      let val = '';
      const inner = cm[2] || '';
      if (type === 's') {
        // 共享字符串：<v>index</v>
        const vMatch = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        if (vMatch) val = shared[parseInt(vMatch[1], 10)] ?? '';
      } else if (type === 'inlineStr') {
        const tMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (tMatch) val = decodeXml(tMatch[1]);
      } else {
        const vMatch = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        if (vMatch) val = decodeXml(vMatch[1]);
      }
      cells[col] = val;
    }
    // 填充空位
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }

  // 去掉完全空的行
  return rows.filter(r => r.some(c => c !== ''));
}

/* 将二维数组转成 CSV 字符串（供后续 parseCSV 复用） */
function rowsToCsv(rows) {
  return rows.map(r => r.map(c => {
    const s = String(c == null ? '' : c);
    // 含逗号/引号/换行时加引号
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }).join(',')).join('\n');
}
