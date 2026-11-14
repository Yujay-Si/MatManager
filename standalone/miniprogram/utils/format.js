'use strict';

/** 数字与时间格式化（不依赖 Intl，兼容 iOS / Android 小程序 JS 引擎）。 */

function thousands(value) {
  var number = Number(value);
  if (!isFinite(number)) return String(value);
  var negative = number < 0;
  var text = String(Math.abs(number));
  var parts = text.split('.');
  var integer = parts[0];
  var decimals = parts.length > 1 ? '.' + parts[1] : '';
  var output = '';
  var count = 0;
  for (var i = integer.length - 1; i >= 0; i -= 1) {
    output = integer[i] + output;
    count += 1;
    if (count % 3 === 0 && i > 0) output = ',' + output;
  }
  return (negative ? '-' : '') + output + decimals;
}

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function dateTime(value) {
  var date = new Date(value);
  if (isNaN(date.getTime())) return '时间未知';
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** 只清理二进制浮点尾差，不改变参与计算的原始数值。 */
function precise(value) {
  if (typeof value !== 'number' || !isFinite(value)) return value;
  return Number(value.toPrecision(15));
}

function fixed4(value) {
  return Number(value).toFixed(4);
}

module.exports = {
  thousands: thousands,
  dateTime: dateTime,
  precise: precise,
  fixed4: fixed4
};
