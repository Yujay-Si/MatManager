'use strict';

const assert = require('node:assert/strict');
require('../src/calculation.js');
require('../src/batch-data.js');
require('../src/result-output.js');

const calculator = globalThis.MaterialCalculator;
const batch = globalThis.BatchData;
const output = globalThis.ResultOutput;

const base = {
  material: '201',
  thickness: '0.3',
  width: '600',
  weight: '100',
  mode: 'double',
  formula: 2
};

const result = calculator.calculate(base);
assert.equal(result.cut, 320, '双排剪口应为 320 mm');
assert.equal(result.squareUnitWeight.toFixed(4), '0.1912', '第 2 套单重应保留四位小数为 0.1912');
assert.equal(result.quantity, 430, '示例预计数量应为 430 个');
assert.equal(result.scrapRatio, 0.12, '双排角料比例应为 12%');
assert.equal(Number(result.scrapWeight.toPrecision(12)), 12, '双排 100 kg 材料的角料重量应为 12 kg');

const singleResult = calculator.calculate({ ...base, mode: 'single', formula: 1 });
assert.equal(singleResult.scrapRatio, 0.22, '单排角料比例应为 22%');
assert.equal(Number(singleResult.scrapWeight.toPrecision(12)), 22, '单排 100 kg 材料的角料重量应为 22 kg');
// 第 3 套方片公式同样按材料总重算角料。
const sheetResult = calculator.calculate({ ...base, mode: 'single', formula: 3 });
assert.equal(Number(sheetResult.scrapWeight.toPrecision(12)), 22, '第 3 套角料重量仍按材料总重计算');

assert.throws(
  () => calculator.calculate({ ...base, mode: 'double', formula: 3 }),
  /第 3 套/,
  '第 3 套公式只允许单排'
);

const rows = batch.rowsFromText(
  '材质,厚度(mm),宽度(mm),材料重量(kg),冲料方式,单重公式\n201,0.3,600,100,双排,2'
);
const batchResults = batch.calculateRows(rows, input => calculator.calculate(input));
assert.equal(batchResults.length, 1);
assert.equal(batchResults[0].result.quantity, 430, '批量计算应与单次计算一致');

const template = batch.templateCsv();
assert.match(template, /^﻿材质,厚度\(mm\),宽度\(mm\),材料重量\(kg\),冲料方式,单重公式/);

assert.ok(output.HEADERS.includes('角料重量(kg)'), '导出表头应包含角料重量');
const exportedRow = output.resultValues(result);
assert.equal(exportedRow.length, output.HEADERS.length, '导出列数应与表头一致');
assert.equal(exportedRow[output.HEADERS.indexOf('角料比例系数')], 0.12);
assert.equal(Number(exportedRow[output.HEADERS.indexOf('角料重量(kg)')].toPrecision(12)), 12);
// 旧版本（2.0.0）历史记录没有角料字段：导出留空，不按新规则回填。
const legacy = JSON.parse(JSON.stringify(result));
delete legacy.scrapRatio;
delete legacy.scrapWeight;
delete legacy.parameters.scrapRatio;
const legacyRow = output.resultValues(legacy);
assert.equal(legacyRow[output.HEADERS.indexOf('角料重量(kg)')], '', '旧记录角料列应为空');

console.log('独立计算模块冒烟测试通过：单次 430 个、批量 430 个、角料 12/22 kg、第 3 套约束与模板表头均正常。');
