'use strict';

/**
 * 文件导出与分享（微信小程序版）
 * 小程序没有浏览器下载通道，导出流程是：
 *   写入本地用户目录 → wx.shareFileMessage 转发到聊天 / 文件传输助手 → 在电脑端保存
 * PC 端微信另可用 wx.saveFileToDisk 直接另存。
 */

function isWeChat() {
  return typeof wx !== 'undefined' && wx && typeof wx.getFileSystemManager === 'function';
}

function userPath(name) {
  var base = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '';
  return base + '/' + name;
}

function writeTextFile(name, text) {
  var filePath = userPath(name);
  try {
    wx.getFileSystemManager().writeFileSync(filePath, text, 'utf8');
  } catch (error) {
    throw new Error('生成文件失败：' + ((error && error.errMsg) || '本地存储不可用'));
  }
  return filePath;
}

/**
 * @param {string} filePath 本地文件路径
 * @param {string} fileName 展示给对方的文件名
 * @param {{onSuccess?:Function,onCancel?:Function,onError?:Function}} handlers
 */
function shareFile(filePath, fileName, handlers) {
  var callbacks = handlers || {};
  if (typeof wx.shareFileMessage === 'function') {
    wx.shareFileMessage({
      filePath: filePath,
      fileName: fileName,
      success: function () {
        if (callbacks.onSuccess) callbacks.onSuccess();
      },
      fail: function (error) {
        var message = (error && error.errMsg) || '';
        if (message.indexOf('cancel') !== -1) {
          if (callbacks.onCancel) callbacks.onCancel();
          return;
        }
        saveToDisk(filePath, fileName, callbacks, message);
      }
    });
    return;
  }
  saveToDisk(filePath, fileName, callbacks, '当前微信版本不支持直接转发文件');
}

function saveToDisk(filePath, fileName, callbacks, previousMessage) {
  if (typeof wx.saveFileToDisk === 'function') {
    wx.saveFileToDisk({
      filePath: filePath,
      success: function () {
        if (callbacks.onSuccess) callbacks.onSuccess();
      },
      fail: function (error) {
        var message = (error && error.errMsg) || '';
        if (message.indexOf('cancel') !== -1) {
          if (callbacks.onCancel) callbacks.onCancel();
          return;
        }
        if (callbacks.onError) callbacks.onError(new Error(previousMessage || message || '文件导出失败'));
      }
    });
    return;
  }
  if (callbacks.onError) {
    callbacks.onError(new Error(previousMessage || '文件导出失败，请在手机上使用「转发给朋友」或复制内容'));
  }
}

/** 一体化导出：文本 → 文件 → 分享。 */
function exportTextFile(fileName, text, handlers) {
  if (!isWeChat()) {
    if (handlers && handlers.onError) handlers.onError(new Error('当前环境不支持文件导出。'));
    return;
  }
  var filePath;
  try {
    filePath = writeTextFile(fileName, text);
  } catch (error) {
    if (handlers && handlers.onError) handlers.onError(error);
    return;
  }
  shareFile(filePath, fileName, handlers);
}

function copyText(text, title) {
  return new Promise(function (resolve, reject) {
    wx.setClipboardData({
      data: text,
      success: function () {
        if (title) {
          wx.showToast({ title: title, icon: 'success' });
        }
        resolve();
      },
      fail: function (error) {
        reject(new Error((error && error.errMsg) || '复制失败'));
      }
    });
  });
}

module.exports = {
  isWeChat: isWeChat,
  writeTextFile: writeTextFile,
  shareFile: shareFile,
  exportTextFile: exportTextFile,
  copyText: copyText
};
