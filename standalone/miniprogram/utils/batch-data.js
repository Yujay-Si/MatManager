'use strict';

/**
 * 批量数据 · CSV 解析与逐行计算（微信小程序版）
 * 与原 Web 版 src/batch-data.js 保持一致：同一套表头、同一套错误文案、最多 500 行。
 * 差异：小程序内不做 XLSX 二进制解析（见 README「能力对照」），统一使用 CSV。
 */

var HEADERS = Object.freeze(['材质', '厚度(mm)', '宽度(mm)', '材料重量(kg)', '冲料方式', '单重公式']);
var MAX_ROWS = 500;
var MAX_FILE_BYTES = 2 * 1024 * 1024;

function parseDelimited(text, delimiter) {
  var rows = [];
  var cells = [];
  var field = '';
  var inQuotes = false;
  var afterQuote = false;
  var line = 1;
  var rowLine = 1;
  var index = 0;

  while (index < text.length) {
    var char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
        afterQuote = true;
      } else {
        field += char;
        if (char === '\n') line += 1;
      }
    } else if (char === delimiter) {
      cells.push(field);
      field = '';
      afterQuote = false;
    } else if (char === '\n' || char === '\r') {
      cells.push(field);
      rows.push({ line: rowLine, values: cells });
      cells = [];
      field = '';
      afterQuote = false;
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      line += 1;
      rowLine = line;
    } else if (char === '"' && field === '' && !afterQuote) {
      inQuotes = true;
    } else if (afterQuote && char !== ' ' && char !== '\t') {
      throw new Error('第 ' + line + ' 行引号后存在无效字符。');
    } else if (!afterQuote) {
      field += char;
    }
    index += 1;
  }
  if (inQuotes) throw new Error('第 ' + rowLine + ' 行引号未闭合。');
  if (field !== '' || cells.length > 0 || afterQuote) {
    cells.push(field);
    rows.push({ line: rowLine, values: cells });
  }
  return rows;
}

function rowsFromText(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('请输入或导入批量数据。');
  var clean = text.replace(/^\uFEFF/, '');
  var firstLine = clean.split(/\r?\n/, 1)[0];
  var delimiter = firstLine.indexOf('\t') !== -1 && firstLine.indexOf(',') === -1 ? '\t' : ',';
  return parseDelimited(clean, delimiter);
}

function calculateRows(rows, calculate) {
  var populated = [];
  for (var i = 0; i < rows.length; i += 1) {
    var valuesOfRow = rows[i].values;
    var hasValue = false;
    for (var j = 0; j < valuesOfRow.length; j += 1) {
      if (String(valuesOfRow[j]).trim() !== '') {
        hasValue = true;
        break;
      }
    }
    if (hasValue) populated.push(rows[i]);
  }
  if (populated.length < 2) throw new Error('批量数据至少需要表头和一条材料记录。');

  var headers = populated[0].values.map(function (value) {
    return String(value).replace(/^\uFEFF/, '').trim();
  });
  var headerOk = headers.length === HEADERS.length;
  if (headerOk) {
    for (var k = 0; k < HEADERS.length; k += 1) {
      if (headers[k] !== HEADERS[k]) {
        headerOk = false;
        break;
      }
    }
  }
  if (!headerOk) throw new Error('表头必须依次为：' + HEADERS.join('、') + '。');

  var dataRows = populated.slice(1);
  if (dataRows.length > MAX_ROWS) throw new Error('单次最多处理 ' + MAX_ROWS + ' 条材料记录。');

  return dataRows.map(function (row) {
    var values = row.values.map(function (value) {
      return String(value).trim();
    });
    if (values.length !== HEADERS.length) {
      return {
        line: row.line,
        source: values,
        error: '字段数量应为 ' + HEADERS.length + ' 列，实际为 ' + values.length + ' 列。'
      };
    }
    var mode = values[4] === '单排' ? 'single' : values[4] === '双排' ? 'double' : values[4];
    var formula = values[5] === '' ? 1 : values[5];
    try {
      var result = calculate({
        material: values[0],
        thickness: values[1],
        width: values[2],
        weight: values[3],
        mode: mode,
        formula: formula
      });
      return { line: row.line, source: values, result: result };
    } catch (error) {
      return {
        line: row.line,
        source: values,
        error: error instanceof Error ? error.message : '计算失败。'
      };
    }
  });
}

function templateCsv() {
  return '\uFEFF' + HEADERS.join(',') + '\r\n201,0.3,600,100,双排,2\r\n';
}

module.exports = {
  HEADERS: HEADERS,
  MAX_ROWS: MAX_ROWS,
  MAX_FILE_BYTES: MAX_FILE_BYTES,
  rowsFromText: rowsFromText,
  calculateRows: calculateRows,
  templateCsv: templateCsv
};
