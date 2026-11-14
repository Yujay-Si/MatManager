'use strict';

/**
 * 导出模块（微信小程序版）
 * CSV/XLSX 导出改为「生成文件 → 转发到微信聊天」，打印改为「复制文本 / 分享」。
 * 表头与列顺序与原 Web 版 src/result-output.js 完全一致，导出的 CSV 可直接用 Excel 打开。
 */

var format = require('./format');

var HEADERS = Object.freeze([
  '材质', '厚度(mm)', '宽度(mm)', '材料重量(kg)', '冲料方式', '最终剪口(mm)',
  '冲料圆片比例系数', '可用重量(kg)', '角料比例系数', '角料重量(kg)',
  '第1套单重原值(kg/个)', '第2套单重原值(kg/个)',
  '所选单重公式', '所选单重原值(kg/个)', '预计数量(个)', '第1套密度系数',
  '第2套密度系数', '剪口换算参数', '剪口步长(mm)', '圆周率参数',
  '公式版本', '参数版本', '计算时间'
]);

function resultValues(result) {
  var input = result.input;
  var parameters = result.parameters;
  // 2.0.0 及更早的历史记录没有角料字段：导出时留空，避免把新规则回填成历史事实。
  var hasScrap = typeof result.scrapWeight === 'number' && isFinite(result.scrapWeight);
  var scrapRatio = hasScrap
    ? (parameters.scrapRatio === undefined ? result.scrapRatio : parameters.scrapRatio)
    : '';
  return [
    input.material,
    input.thickness,
    input.width,
    input.weight,
    input.mode === 'single' ? '单排' : '双排',
    result.cut,
    input.formula === 3 ? '未参与' : parameters.usableFactor,
    format.precise(result.usableWeight),
    scrapRatio === '' ? '' : format.precise(scrapRatio),
    hasScrap ? format.precise(result.scrapWeight) : '',
    format.precise(result.radiusUnitWeight),
    format.precise(result.squareUnitWeight),
    input.formula === 3 ? '第 3 套（方片密度算法公式）'
      : input.formula === 1 ? '第 1 套（圆片密度算法公式）'
        : '第 2 套（圆片密度高级算法公式）',
    format.precise(result.selectedUnitWeight),
    result.quantity,
    parameters.radiusFactor,
    parameters.squareFactor,
    parameters.widthDivisor,
    parameters.cutStep,
    parameters.pi,
    result.formulaVersion,
    result.parameterVersion || '默认参数（旧记录）',
    result.calculatedAt
  ];
}

function table(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('没有可导出或分享的有效计算结果。');
  }
  return [HEADERS].concat(results.map(resultValues));
}

function csv(results) {
  var rows = table(results);
  var lines = rows.map(function (row) {
    return row.map(function (value) {
      var text = String(value === undefined || value === null ? '' : value);
      // 防止文本字段被表格软件当作公式；数值列仍保持数值格式。
      var safe = typeof value === 'string' && /^[=+\-@]/.test(text) ? "'" + text : text;
      return '"' + safe.replace(/"/g, '""') + '"';
    }).join(',');
  });
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function formulaLabel(formula, formulaVersion) {
  var number = Number(formula);
  var legacy = /^1\./.test(String(formulaVersion || ''));
  if (number === 3) return '第 3 套 · 方片密度算法公式';
  if (legacy && number === 1) return '旧第 1 套 · 圆片密度高级算法公式（现第 2 套）';
  if (legacy && number === 2) return '旧第 2 套 · 圆片密度算法公式（现第 1 套）';
  return '第 ' + number + ' 套 · ' + (number === 1 ? '圆片密度算法公式' : '圆片密度高级算法公式');
}

/** 结果摘要文本，用于「复制结果」与分享标题。 */
function textSummary(result) {
  if (!result || !result.input) throw new Error('没有可复制的计算结果。');
  var input = result.input;
  var lines = [
    '圆片算量 · 材料冲片计算',
    '材质：' + input.material,
    '冲料方式：' + (input.mode === 'single' ? '单排' : '双排'),
    '厚度：' + input.thickness + ' mm',
    '宽度：' + input.width + ' mm',
    '材料重量：' + input.weight + ' kg',
    '最终剪口：' + result.cut + ' mm'
  ];
  if (typeof result.scrapWeight === 'number' && isFinite(result.scrapWeight)) {
    lines.push('角料比例系数：' + result.scrapRatio);
    lines.push('角料重量：' + format.precise(result.scrapWeight) + ' kg');
  }
  lines.push('单重公式：' + formulaLabel(input.formula, result.formulaVersion));
  lines.push('所选单重原值：' + format.precise(result.selectedUnitWeight) + ' kg/个');
  lines.push('预计数量：' + result.quantity + ' 个');
  lines.push('公式版本：' + result.formulaVersion);
  lines.push('参数版本：' + (result.parameterVersion || '默认参数（旧记录）'));
  lines.push('计算时间：' + format.dateTime(result.calculatedAt));
  return lines.join('\n');
}

/** 历史记录详情面板用的键值对。 */
function detailPairs(result) {
  if (!result || !result.input) return [];
  var input = result.input;
  var parameters = result.parameters;
  var pairs = [
    { key: '厚度', value: input.thickness + ' mm' },
    { key: '宽度', value: input.width + ' mm' },
    { key: '材料重量', value: input.weight + ' kg' },
    { key: '最终剪口', value: result.cut + ' mm' },
    { key: '单重公式', value: formulaLabel(input.formula, result.formulaVersion) },
    { key: '选中单重原值', value: format.precise(result.selectedUnitWeight) + ' kg/个' }
  ];
  if (input.formula === 3) {
    pairs.push({ key: '方片单重', value: format.precise(result.sheetUnitWeight) + ' kg/个' });
  }
  pairs.push({ key: '第 1 套密度系数', value: parameters.radiusFactor });
  pairs.push({ key: '第 2 套密度系数', value: parameters.squareFactor });
  pairs.push({
    key: input.mode === 'single' ? '单排冲料圆片比例系数' : '双排冲料圆片比例系数',
    value: input.formula === 3 ? '未参与（配置值 ' + parameters.usableFactor + '）' : parameters.usableFactor
  });
  if (input.formula === 3) {
    pairs.push({ key: '参与计算重量', value: result.usableWeight + ' kg' });
  }
  if (typeof result.scrapWeight === 'number' && isFinite(result.scrapWeight)) {
    pairs.push({
      key: input.mode === 'single' ? '单排角料比例系数' : '双排角料比例系数',
      value: parameters.scrapRatio
    });
    pairs.push({ key: '角料重量', value: format.precise(result.scrapWeight) + ' kg' });
  } else {
    pairs.push({ key: '角料重量', value: '旧版本记录未含角料数据' });
  }
  pairs.push({ key: '剪口换算参数', value: parameters.widthDivisor });
  pairs.push({ key: '剪口步长', value: parameters.cutStep });
  pairs.push({ key: '圆周率参数', value: parameters.pi });
  pairs.push({ key: '公式版本', value: result.formulaVersion });
  pairs.push({ key: '参数版本', value: result.parameterVersion || '默认参数（旧记录）' });
  pairs.push({ key: '计算时间', value: format.dateTime(result.calculatedAt) });
  return pairs;
}

module.exports = {
  HEADERS: HEADERS,
  resultValues: resultValues,
  table: table,
  csv: csv,
  textSummary: textSummary,
  detailPairs: detailPairs,
  formulaLabel: formulaLabel
};
