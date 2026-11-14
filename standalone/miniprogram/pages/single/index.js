'use strict';

var calculation = require('../../utils/calculation');
var parameterStore = require('../../utils/parameter-store');
var historyStore = require('../../utils/history-store');
var resultOutput = require('../../utils/result-output');
var format = require('../../utils/format');
var fileShare = require('../../utils/file-share');

var MATERIAL_LABELS = ['410', '201', '304', '316'];
var MODE_LABELS = ['单排', '双排'];
var MODE_VALUES = ['single', 'double'];

function buildFormulas(mode) {
  var list = [
    { value: '1', title: '第 1 套', desc: '圆片密度算法公式 · 默认' },
    { value: '2', title: '第 2 套', desc: '圆片密度高级算法公式' }
  ];
  if (mode === 'single') {
    list.push({ value: '3', title: '第 3 套', desc: '方片密度算法公式 · 材料总重直接计算' });
  }
  return list;
}

Page({
  data: {
    materialLabels: MATERIAL_LABELS,
    materialIndex: 1,
    modeLabels: MODE_LABELS,
    modeIndex: 1,
    thickness: '',
    width: '',
    weight: '',
    formulas: buildFormulas('double'),
    formula: '1',
    result: null,
    status: '',
    statusError: false,
    error: '',
    parameterVersion: '默认参数 v0'
  },

  lastResult: null,

  onShow: function () {
    this.refreshParameterVersion();
  },

  refreshParameterVersion: function () {
    try {
      var state = parameterStore.readState();
      this.setData({
        parameterVersion: state.revision === 0 ? '默认参数 v0' : '本机参数 v' + state.revision
      });
    } catch (error) {
      this.setData({ parameterVersion: '本地参数异常' });
    }
  },

  onMaterialChange: function (event) {
    this.setData({ materialIndex: Number(event.detail.value) });
  },

  onModeChange: function (event) {
    var index = Number(event.detail.value);
    var mode = MODE_VALUES[index];
    var patch = { modeIndex: index, formulas: buildFormulas(mode) };
    if (mode !== 'single' && this.data.formula === '3') patch.formula = '1';
    this.setData(patch);
  },

  onThicknessInput: function (event) {
    this.setData({ thickness: event.detail.value });
  },

  onWidthInput: function (event) {
    this.setData({ width: event.detail.value });
  },

  onWeightInput: function (event) {
    this.setData({ weight: event.detail.value });
  },

  onFormulaSelect: function (event) {
    this.setData({ formula: String(event.currentTarget.dataset.value) });
  },

  onCalculate: function () {
    var input = {
      material: MATERIAL_LABELS[this.data.materialIndex],
      mode: MODE_VALUES[this.data.modeIndex],
      thickness: this.data.thickness,
      width: this.data.width,
      weight: this.data.weight,
      formula: this.data.formula
    };

    var result;
    try {
      result = calculation.calculate(input, parameterStore.readState().parameters);
    } catch (error) {
      this.lastResult = null;
      this.setData({ error: error.message || '计算失败，请检查输入。', result: null, status: '' });
      return;
    }

    this.lastResult = result;
    this.setData({
      result: this.buildResultView(result),
      error: '',
      status: '',
      statusError: false
    });

    try {
      historyStore.addResults([result]);
      this.setData({ status: '计算结果已保存到本机历史记录。', statusError: false });
    } catch (error) {
      this.setData({ status: '结果已生成，但历史未保存：' + error.message, statusError: true });
    }
  },

  buildResultView: function (result) {
    var input = result.input;
    var parameters = result.parameters;
    var usesSheetFormula = input.formula === 3;
    var modeText = input.mode === 'single' ? '单排' : '双排';

    var inputPairs = [
      { key: '材质', value: input.material },
      { key: '冲料方式', value: modeText },
      { key: '厚度', value: input.thickness + ' mm' },
      { key: '宽度', value: input.width + ' mm' },
      { key: '材料重量', value: input.weight + ' kg' },
      { key: '最终剪口', value: result.cut + ' mm' }
    ];

    var basisPairs = [
      {
        key: input.mode === 'single' ? '单排冲料圆片比例系数' : '双排冲料圆片比例系数',
        value: usesSheetFormula ? '未参与（使用材料总重）' : parameters.usableFactor
      },
      {
        key: usesSheetFormula ? '参与计算重量' : '可用重量',
        value: format.thousands(format.precise(result.usableWeight)) + ' kg'
      },
      {
        key: input.mode === 'single' ? '单排角料比例系数' : '双排角料比例系数',
        value: parameters.scrapRatio
      },
      { key: '角料重量', value: format.precise(result.scrapWeight) + ' kg' },
      { key: '第 1 套单重', value: format.fixed4(result.radiusUnitWeight) + ' kg/个' },
      { key: '第 2 套单重', value: format.fixed4(result.squareUnitWeight) + ' kg/个' }
    ];

    if (usesSheetFormula) {
      basisPairs.push({ key: '第 3 套方片单重', value: format.fixed4(result.sheetUnitWeight) + ' kg/个' });
    }

    basisPairs.push({
      key: '选用公式',
      value: usesSheetFormula ? '第 3 套 · 方片密度算法公式'
        : input.formula === 1 ? '第 1 套 · 圆片密度算法公式'
          : '第 2 套 · 圆片密度高级算法公式'
    });
    basisPairs.push({
      key: '选用密度系数',
      value: input.formula === 2 ? parameters.squareFactor : parameters.radiusFactor
    });
    basisPairs.push({ key: '公式版本', value: result.formulaVersion });
    basisPairs.push({ key: '参数版本', value: result.parameterVersion || '默认参数（旧记录）' });
    basisPairs.push({ key: '计算时间', value: format.dateTime(result.calculatedAt), wide: true });

    return {
      quantityText: format.thousands(result.quantity),
      basis: usesSheetFormula
        ? '按方片单重用材料总重换算圆片数量，使用未舍入单重并向下取整'
        : '使用所选公式的未舍入单重计算，最终向下取整',
      inputPairs: inputPairs,
      basisPairs: basisPairs
    };
  },

  onCopy: function () {
    if (!this.lastResult) {
      wx.showToast({ title: '请先计算', icon: 'none' });
      return;
    }
    var self = this;
    fileShare.copyText(resultOutput.textSummary(this.lastResult), '已复制')
      .catch(function (error) {
        self.setData({ status: error.message, statusError: true });
      });
  },

  onExportCsv: function () {
    if (!this.lastResult) {
      wx.showToast({ title: '请先计算', icon: 'none' });
      return;
    }
    var self = this;
    try {
      var text = resultOutput.csv([this.lastResult]);
      fileShare.exportTextFile('单次计算结果.csv', text, {
        onSuccess: function () {
          self.setData({ status: 'CSV 已发送到聊天，可在电脑端保存后用 Excel 打开。', statusError: false });
        },
        onCancel: function () {
          self.setData({ status: '已取消导出。', statusError: false });
        },
        onError: function (error) {
          self.setData({ status: error.message, statusError: true });
        }
      });
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
    }
  },

  onGoHistory: function () {
    wx.switchTab({ url: '/pages/history/index' });
  },

  onShareAppMessage: function () {
    var title = '圆片算量 · 冲片数量离线计算';
    if (this.lastResult) {
      title = '材料计算：' + this.lastResult.quantity + ' 个（' + this.lastResult.input.material + '）';
    }
    return { title: title, path: '/pages/single/index' };
  }
});
