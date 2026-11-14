'use strict';

var calculation = require('../../utils/calculation');
var parameterStore = require('../../utils/parameter-store');
var historyStore = require('../../utils/history-store');
var batchData = require('../../utils/batch-data');
var resultOutput = require('../../utils/result-output');
var format = require('../../utils/format');
var fileShare = require('../../utils/file-share');

function sizeText(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

Page({
  data: {
    text: '',
    fileName: '',
    fileSizeText: '',
    rows: [],
    summary: '',
    status: '',
    statusError: false
  },

  importedRows: null,
  validResults: [],
  invalidRows: [],

  onTextInput: function (event) {
    this.importedRows = null;
    this.setData({
      text: event.detail.value,
      fileName: '',
      fileSizeText: '',
      status: '',
      statusError: false
    });
  },

  onCopyTemplate: function () {
    var template = batchData.templateCsv().replace(/^\uFEFF/, '');
    fileShare.copyText(template, '模板已复制')
      .catch(function (error) {
        wx.showToast({ title: error.message, icon: 'none' });
      });
  },

  onSaveTemplate: function () {
    var self = this;
    fileShare.exportTextFile('材料批量导入模板.csv', batchData.templateCsv(), {
      onSuccess: function () {
        self.setData({ status: '模板文件已发送到聊天，可在电脑端保存后填写。', statusError: false });
      },
      onCancel: function () {
        self.setData({ status: '已取消导出。', statusError: false });
      },
      onError: function (error) {
        self.setData({ status: error.message, statusError: true });
      }
    });
  },

  onChooseFile: function () {
    var self = this;
    if (typeof wx.chooseMessageFile !== 'function') {
      this.setData({ status: '当前微信版本不支持选择文件，请改用粘贴数据。', statusError: true });
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv'],
      success: function (result) {
        var file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        if (file.size > batchData.MAX_FILE_BYTES) {
          self.setData({ status: '文件超过 2 MB 上限。', statusError: true });
          return;
        }
        try {
          var text = wx.getFileSystemManager().readFileSync(file.path, 'utf-8');
          var rows = batchData.rowsFromText(text);
          self.importedRows = rows;
          self.setData({
            text: '',
            fileName: file.name,
            fileSizeText: sizeText(file.size),
            status: '已读取 ' + file.name + '，点击「计算批量数据」查看逐行结果。',
            statusError: false
          });
        } catch (error) {
          self.importedRows = null;
          self.setData({
            status: error.message || '读取文件失败，请确认文件为 UTF-8 编码的 CSV。',
            statusError: true
          });
        }
      },
      fail: function (error) {
        var message = (error && error.errMsg) || '';
        if (message.indexOf('cancel') !== -1) return;
        self.setData({ status: '选择文件失败：' + message, statusError: true });
      }
    });
  },

  onRun: function () {
    var rows;
    try {
      rows = this.importedRows || batchData.rowsFromText(this.data.text);
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
      return;
    }

    var parameters;
    try {
      parameters = parameterStore.readState().parameters;
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
      return;
    }

    var outcome;
    try {
      outcome = batchData.calculateRows(rows, function (input) {
        return calculation.calculate(input, parameters);
      });
    } catch (error) {
      this.setData({ status: error.message, statusError: true });
      return;
    }

    var valid = [];
    var invalid = [];
    var viewRows = outcome.map(function (row) {
      if (row.result) {
        valid.push(row.result);
        return {
          line: row.line,
          material: row.result.input.material,
          thickness: row.result.input.thickness,
          width: row.result.input.width,
          weight: row.result.input.weight,
          modeText: row.result.input.mode === 'single' ? '单排' : '双排',
          cut: row.result.cut,
          quantityText: format.thousands(row.result.quantity),
          scrapText: format.precise(row.result.scrapWeight),
          stateText: row.result.input.formula === 3 ? '成功·方片' : '成功',
          isError: false
        };
      }
      invalid.push(row);
      return {
        line: row.line,
        material: (row.source && row.source[0]) || '—',
        thickness: (row.source && row.source[1]) || '—',
        width: (row.source && row.source[2]) || '—',
        weight: (row.source && row.source[3]) || '—',
        modeText: (row.source && row.source[4]) || '—',
        cut: '—',
        quantityText: '—',
        scrapText: '—',
        stateText: row.error,
        isError: true
      };
    });

    this.validResults = valid;
    this.invalidRows = invalid;
    this.setData({
      rows: viewRows,
      summary: '成功 ' + valid.length + ' 条 / 错误 ' + invalid.length + ' 条',
      status: '',
      statusError: false
    });

    if (valid.length === 0) {
      this.setData({ status: '没有可用的有效行，请按错误提示修正后重试。', statusError: true });
      return;
    }

    try {
      historyStore.addResults(valid);
      this.setData({
        status: '已处理 ' + outcome.length + ' 条，成功记录已保存到历史。',
        statusError: invalid.length > 0
      });
    } catch (error) {
      this.setData({ status: '已生成结果，但历史未保存：' + error.message, statusError: true });
    }
  },

  onExportCsv: function () {
    var self = this;
    if (!this.validResults.length) {
      wx.showToast({ title: '没有有效行可导出', icon: 'none' });
      return;
    }
    try {
      fileShare.exportTextFile('批量计算结果.csv', resultOutput.csv(this.validResults), {
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

  onCopyInvalid: function () {
    if (!this.invalidRows.length) {
      wx.showToast({ title: '没有错误行', icon: 'none' });
      return;
    }
    var lines = this.invalidRows.map(function (row) {
      return '第 ' + row.line + ' 行：' + row.error;
    });
    fileShare.copyText(lines.join('\n'), '已复制')
      .catch(function (error) {
        wx.showToast({ title: error.message, icon: 'none' });
      });
  },

  onShareAppMessage: function () {
    return { title: '圆片算量 · 批量算片', path: '/pages/batch/index' };
  }
});
