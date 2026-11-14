'use strict';

/**
 * 材料数据计算 · 公式内核（微信小程序版）
 * 与原 Web 版 src/calculation.js 逐行等价，仅改为 CommonJS 模块。
 */

var FORMULA_VERSION = '2.1.0';

var DEFAULT_PARAMETERS = Object.freeze({
  materials: Object.freeze({
    '410': Object.freeze({ square: 6.162, radius: 0.785 }),
    '201': Object.freeze({ square: 6.225, radius: 0.793 }),
    '304': Object.freeze({ square: 6.225, radius: 0.793 }),
    '316': Object.freeze({ square: 6.264, radius: 0.798 })
  }),
  modes: Object.freeze({
    single: Object.freeze({ widthDivisor: 1, usableFactor: 0.776, scrapRatio: 0.22 }),
    double: Object.freeze({ widthDivisor: 1.87, usableFactor: 0.824, scrapRatio: 0.12 })
  }),
  cutStep: 5,
  pi: 3.14
});

var MATERIALS = Object.freeze(['410', '201', '304', '316']);
var MODES = Object.freeze(['single', 'double']);

function positiveNumber(value, label) {
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error('请输入' + label + '。');
  }
  var number = Number(value);
  if (!isFinite(number) || number <= 0) {
    throw new Error(label + '必须是大于 0 的有效数字。');
  }
  return number;
}

function calculate(input, parameters) {
  var params = parameters || DEFAULT_PARAMETERS;
  if (!input || typeof input !== 'object') {
    throw new Error('请输入材料数据。');
  }
  if (!params || !params.materials || !params.modes) {
    throw new Error('计算参数缺失。');
  }

  var material = input.material === undefined || input.material === null ? '' : String(input.material);
  var mode = input.mode === undefined || input.mode === null ? '' : String(input.mode);
  var selectedFormula = Number(input.formula);
  var materialFactors = params.materials[material];
  var modeFactors = params.modes[mode];

  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PARAMETERS.materials, material) || !materialFactors) {
    throw new Error('请选择有效材质。');
  }
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PARAMETERS.modes, mode) || !modeFactors) {
    throw new Error('请选择有效冲料方式。');
  }
  if ([1, 2, 3].indexOf(selectedFormula) === -1) {
    throw new Error('请选择有效单重公式。');
  }
  if (selectedFormula === 3 && mode !== 'single') {
    throw new Error('第 3 套方片公式仅适用于单排。');
  }

  var thickness = positiveNumber(input.thickness, '厚度');
  var width = positiveNumber(input.width, '宽度');
  var weight = positiveNumber(input.weight, '材料重量');
  var squareFactor = positiveNumber(materialFactors.square, '第 2 套密度系数');
  var radiusFactor = positiveNumber(materialFactors.radius, '第 1 套密度系数');
  var widthDivisor = positiveNumber(modeFactors.widthDivisor, '剪口换算参数');
  var ratioLabel = mode === 'single' ? '单排冲料圆片比例系数' : '双排冲料圆片比例系数';
  var usableFactor = positiveNumber(modeFactors.usableFactor, ratioLabel);
  var cutStep = positiveNumber(params.cutStep, '剪口取整步长');
  var pi = positiveNumber(params.pi, '圆周率参数');
  if (usableFactor > 1) {
    throw new Error(ratioLabel + '不能大于 1。');
  }

  var rawCut = width / widthDivisor;
  var cut = Math.floor(rawCut / cutStep) * cutStep;
  if (!isFinite(cut) || cut <= 0) {
    throw new Error('宽度过小，最终剪口为 0 mm，无法计算。');
  }

  // 数量使用未舍入单重；四位小数仅用于结果显示。
  var squareUnitWeight = cut * cut * thickness * squareFactor / 1000000;
  var radius = cut / 2;
  var radiusUnitWeight = radius * radius * pi * thickness * radiusFactor / 100000;
  var sheetUnitWeight = selectedFormula === 3 ? cut * cut * thickness * radiusFactor / 100000 : null;
  var selectedUnitWeight = selectedFormula === 1 ? radiusUnitWeight
    : selectedFormula === 2 ? squareUnitWeight
      : sheetUnitWeight;
  // 方片公式明确用材料总重计算，不应用单排圆片公式的 0.776 系数。
  var appliedUsableFactor = selectedFormula === 3 ? null : usableFactor;
  var usableWeight = selectedFormula === 3 ? weight : weight * usableFactor;
  // 角料重量按材料总重计算，与所选单重公式无关：双排 12%、单排 22%。
  var scrapLabel = mode === 'single' ? '单排角料比例系数' : '双排角料比例系数';
  var scrapSource = modeFactors.scrapRatio;
  var scrapRatio = (scrapSource === undefined || scrapSource === null || scrapSource === '')
    ? DEFAULT_PARAMETERS.modes[mode].scrapRatio
    : Number(scrapSource);
  if (!isFinite(scrapRatio) || scrapRatio < 0 || scrapRatio > 1) {
    throw new Error(scrapLabel + '须为 0 到 1 之间的数字。');
  }
  var scrapWeight = weight * scrapRatio;
  var rawQuantity = usableWeight / selectedUnitWeight;

  var finiteValues = [squareUnitWeight, radiusUnitWeight, usableWeight, scrapWeight, rawQuantity];
  var allFinite = true;
  for (var i = 0; i < finiteValues.length; i += 1) {
    if (!isFinite(finiteValues[i])) allFinite = false;
  }
  if (!allFinite || !isFinite(selectedUnitWeight) || selectedUnitWeight <= 0 ||
      rawQuantity < 0 || rawQuantity >= Number.MAX_SAFE_INTEGER) {
    throw new Error('计算结果超出有效范围，请检查输入数值。');
  }

  return {
    formulaVersion: FORMULA_VERSION,
    parameterVersion: isSafeInteger(params.revision) && params.revision > 0
      ? '本机参数 v' + params.revision
      : '默认参数 v0',
    parameterUpdatedAt: params.updatedAt || null,
    calculatedAt: new Date().toISOString(),
    input: {
      material: material,
      thickness: thickness,
      width: width,
      weight: weight,
      mode: mode,
      formula: selectedFormula
    },
    parameters: {
      squareFactor: squareFactor,
      radiusFactor: radiusFactor,
      widthDivisor: widthDivisor,
      usableFactor: usableFactor,
      scrapRatio: scrapRatio,
      cutStep: cutStep,
      pi: pi
    },
    rawCut: rawCut,
    cut: cut,
    squareUnitWeight: squareUnitWeight,
    radiusUnitWeight: radiusUnitWeight,
    sheetUnitWeight: sheetUnitWeight,
    selectedUnitWeight: selectedUnitWeight,
    appliedUsableFactor: appliedUsableFactor,
    usableWeight: usableWeight,
    scrapRatio: scrapRatio,
    scrapWeight: scrapWeight,
    quantity: Math.floor(rawQuantity)
  };
}

function isSafeInteger(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function currentInputFromHistory(result) {
  if (!result || !result.input) throw new Error('历史记录缺少计算输入。');
  var version = String(result.formulaVersion || '');
  var oldNumbering = /^1\./.test(version);
  var formula = Number(result.input.formula);
  if (!version) throw new Error('历史记录缺少公式版本，无法安全重算。');
  // v1 的 1=剪口平方、2=剪口半径；v2 起这两个公开编号互换。
  var patched = oldNumbering && (formula === 1 || formula === 2) ? 3 - formula : formula;
  return {
    material: result.input.material,
    thickness: result.input.thickness,
    width: result.input.width,
    weight: result.input.weight,
    mode: result.input.mode,
    formula: patched
  };
}

module.exports = {
  calculate: calculate,
  currentInputFromHistory: currentInputFromHistory,
  DEFAULT_PARAMETERS: DEFAULT_PARAMETERS,
  FORMULA_VERSION: FORMULA_VERSION,
  MATERIALS: MATERIALS,
  MODES: MODES
};
