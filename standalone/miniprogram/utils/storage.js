'use strict';

/**
 * 本地存储适配层：
 * 小程序环境走 wx.setStorageSync / wx.getStorageSync（单账号 10 MB，随小程序卸载清除），
 * Node 测试环境自动退化为内存存储，方便在电脑上跑冒烟测试。
 */

var memory = Object.create(null);

function hasWeChatStorage() {
  return typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function';
}

function getItem(key) {
  if (hasWeChatStorage()) {
    var value;
    try {
      value = wx.getStorageSync(key);
    } catch (error) {
      throw new Error('无法读取本地数据，请检查小程序的存储权限。');
    }
    return value === '' || value === null || value === undefined ? null : value;
  }
  return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
}

function setItem(key, value) {
  if (hasWeChatStorage()) {
    try {
      wx.setStorageSync(key, value);
      return;
    } catch (error) {
      throw new Error('本地保存失败：存储空间不足或不可用。请先导出备份并清理旧记录。');
    }
  }
  memory[key] = value;
}

function removeItem(key) {
  if (hasWeChatStorage()) {
    try {
      wx.removeStorageSync(key);
      return;
    } catch (error) {
      throw new Error('无法删除本地数据。');
    }
  }
  delete memory[key];
}

/** 返回 { currentSize, limitSize }（单位 KB）；非微信环境返回 null。 */
function info() {
  if (!hasWeChatStorage() || typeof wx.getStorageInfoSync !== 'function') return null;
  try {
    var data = wx.getStorageInfoSync();
    return { currentSize: data.currentSize, limitSize: data.limitSize, keys: data.keys || [] };
  } catch (error) {
    return null;
  }
}

module.exports = {
  getItem: getItem,
  setItem: setItem,
  removeItem: removeItem,
  info: info
};
