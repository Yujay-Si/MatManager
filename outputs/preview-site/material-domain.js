(function (global) {
  'use strict';
  const collections = ['suppliers', 'orders', 'receipts', 'payments'];
  const copy = value => JSON.parse(JSON.stringify(value));
  function empty() { return { version: 1, suppliers: [], orders: [], receipts: [], payments: [] }; }
  function text(value, label, required = true) {
    if (typeof value !== 'string' || value.length > 500 || (required && !value.trim())) throw new Error(`${label}不能为空且最多500字。`);
    return value.trim();
  }
  function date(value) {
    const parsed = new Date(value + 'T00:00:00Z');
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('日期格式不正确。');
    return value;
  }
  // Convert decimal strings to scaled integers before arithmetic; avoid binary floating point rounding.
  function scaled(value, digits, label, signed = false) {
    const raw = String(value).trim();
    const expression = new RegExp(`^${signed ? '-?' : ''}\\d{1,10}(?:\\.\\d{1,${digits}})?$`);
    if (!expression.test(raw)) throw new Error(`${label}须为${signed ? '' : '非负'}数字，最多${digits}位小数。`);
    const negative = raw.startsWith('-');
    const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
    const result = BigInt(whole) * (10n ** BigInt(digits)) + BigInt(fraction.padEnd(digits, '0'));
    return negative ? -result : result;
  }
  function safe(value) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || Math.abs(n) > 1e14) throw new Error('金额或数量超过支持范围。');
    return n;
  }
  const cents = (value, label = '金额', signed = false) => safe(scaled(value, 2, label, signed));
  function quantity(value) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0 || n > 10000000) throw new Error('件数须为1至10000000之间的整数。');
    return n;
  }
  function receiptTotals(doc) {
    let milli = 0n, total = 0n;
    for (const line of doc.lines) {
      if (!Array.isArray(line.weights) || !line.weights.length || line.weights.length > 1000) throw new Error('每条收货明细需录入1至1000捆重量。');
      const weight = line.weights.reduce((sum, v) => {
        const w = scaled(v, 3, '每捆重量');
        if (w <= 0n) throw new Error('每捆重量必须大于0。');
        return sum + w;
      }, 0n);
      const price = scaled(line.price, 4, '单价');
      // kg uses 3 decimals, yuan/kg uses 4. Round each line to cents, then sum.
      const amount = (weight * price + 50000n) / 100000n;
      safe(weight); safe(amount);
      milli += weight; total += amount;
    }
    return { weight: safe(milli) / 1000, cents: safe(total) };
  }
  function paymentCents(doc) { return safe(BigInt(cents(doc.repayment, '还款金额')) + BigInt(cents(doc.discount, '退差金额'))); }
  function remaining(state, orderId, lineId) {
    const order = state.orders.find(o => o.id === orderId);
    const line = order?.lines.find(l => l.id === lineId);
    if (!line) throw new Error('关联订货明细不存在。');
    let received = 0;
    for (const doc of state.receipts.filter(r => !r.voided)) {
      for (const row of doc.lines) if (row.orderId === orderId && row.orderLineId === lineId) received += Number(row.quantity);
    }
    return Number(line.quantity) - received;
  }
  function relatedReceipts(state, orderId) {
    if (!state.orders.some(o => o.id === orderId)) throw new Error('订货单不存在。');
    // Group by receipt, using only this order's lines. A receipt can contain multiple orders.
    return state.receipts.map(doc => {
      const lines = doc.lines.filter(line => line.orderId === orderId);
      if (!lines.length) return null;
      return { doc, lines, quantity: lines.reduce((sum, line) => sum + Number(line.quantity), 0), ...receiptTotals({ lines }) };
    }).filter(Boolean).sort((a, b) => a.doc.date.localeCompare(b.doc.date) || a.doc.sequence - b.doc.sequence);
  }
  function validate(state) {
    if (!state || state.version !== 1 || !collections.every(key => Array.isArray(state[key]) && state[key].length <= 50000)) throw new Error('材料备份结构或版本不正确。');
    const allIds = new Set();
    const names = new Set();
    for (const key of collections) {
      for (const doc of state[key]) {
        text(doc.id, '编号');
        if (allIds.has(doc.id)) throw new Error('单据或供应商编号重复。');
        allIds.add(doc.id);
        if (key === 'suppliers') {
          const name = text(doc.name, '供应商');
          if (names.has(name)) throw new Error('供应商名称重复。');
          names.add(name); date(doc.openingDate); cents(doc.openingAmount, '期初欠款', true);
          for (const [field, label] of [['contact', '联系人'], ['phone', '电话'], ['address', '地址'], ['note', '供应商备注']]) {
            if (doc[field] !== undefined) text(doc[field], label, false);
          }
          if (doc.active !== undefined && typeof doc.active !== 'boolean') throw new Error('供应商状态须为启用或停用。');
          continue;
        }
        if (typeof doc.voided !== 'boolean' || !Number.isSafeInteger(doc.sequence) || doc.sequence < 1) throw new Error('单据状态或排序编号无效。');
        date(doc.date); text(doc.note || '', '备注', false);
        const supplier = state.suppliers.find(s => s.id === doc.supplierId);
        if (!supplier) throw new Error('供应商不存在。');
        if (doc.date < supplier.openingDate) throw new Error('单据日期不能早于供应商期初欠款起算日期。');
        if (key === 'payments') {
          if (paymentCents(doc) <= 0) throw new Error('付款合计必须大于0。');
          continue;
        }
        if (!Array.isArray(doc.lines) || !doc.lines.length || doc.lines.length > 500) throw new Error('单据需有1至500条明细。');
        const lineIds = new Set();
        for (const line of doc.lines) {
          text(line.id, '明细编号');
          if (lineIds.has(line.id)) throw new Error('单据明细编号重复。');
          lineIds.add(line.id);
          text(line.material, '材质'); text(line.spec, '规格'); quantity(line.quantity); scaled(line.price, 4, '单价');
          if (key === 'orders') { text(line.product || '', '产品名称', false); text(line.note || '', '明细备注', false); }
          else {
            text(line.progress || '', '加工进度', false);
            if (Boolean(line.orderId) !== Boolean(line.orderLineId)) throw new Error('订货关联不完整。');
            if (line.orderId) {
              const order = state.orders.find(o => o.id === line.orderId);
              const linked = order?.lines.find(l => l.id === line.orderLineId);
              if (!linked) throw new Error('关联订货明细不存在。');
              if (order.supplierId !== doc.supplierId) throw new Error('收货与订货供应商必须一致。');
              if (!doc.voided && order.voided) throw new Error('仍有关联收货，不能作废订货单。');
              if (order.date > doc.date) throw new Error('收货日期不能早于订货日期。');
              if (!doc.voided && (linked.material !== line.material || linked.spec !== line.spec)) throw new Error('收货材质、规格与关联订货不一致。');
            }
          }
        }
        if (key === 'receipts') receiptTotals(doc);
      }
    }
    for (const order of state.orders) for (const line of order.lines) if (remaining(state, order.id, line.id) < 0) throw new Error('收货件数超出订货未收件数。');
    for (const supplier of state.suppliers) ledger(state, supplier.id); // Also enforce cumulative amount bounds.
    return state;
  }
  function save(state, key, input) {
    if (!collections.includes(key)) throw new Error('未知单据类型。');
    const next = copy(state), doc = copy(input);
    const existing = next[key].find(d => d.id === doc.id);
    if (existing?.voided) throw new Error('已作废单据不能修改。');
    // Disabled suppliers remain valid historical references, but cannot receive new documents.
    if (key !== 'suppliers' && (!existing || existing.supplierId !== doc.supplierId) && next.suppliers.find(s => s.id === doc.supplierId)?.active === false) throw new Error('供应商已停用，不能用于新增单据。');
    if (key !== 'suppliers') {
      doc.voided = false;
      let sequence = 0;
      for (const type of ['orders', 'receipts', 'payments']) for (const record of next[type]) sequence = Math.max(sequence, record.sequence);
      doc.sequence = existing?.sequence || sequence + 1;
    }
    if (key === 'suppliers') doc.name = text(doc.name, '供应商');
    if (existing) next[key][next[key].indexOf(existing)] = doc;
    else next[key].push(doc);
    return validate(next);
  }
  function voidDocument(state, key, id) {
    if (!['orders', 'receipts', 'payments'].includes(key)) throw new Error('此类型不能作废。');
    const next = copy(state), doc = next[key].find(d => d.id === id);
    if (!doc || doc.voided) throw new Error('单据不存在或已作废。');
    doc.voided = true;
    return validate(next);
  }
  function ledger(state, supplierId) {
    const supplier = state.suppliers.find(s => s.id === supplierId);
    if (!supplier) throw new Error('请选择供应商。');
    let balance = cents(supplier.openingAmount, '期初欠款', true);
    const events = [
      ...state.receipts.filter(d => d.supplierId === supplierId && !d.voided).map(doc => ({ type: 'receipts', doc, increaseCents: receiptTotals(doc).cents, decreaseCents: 0 })),
      ...state.payments.filter(d => d.supplierId === supplierId && !d.voided).map(doc => ({ type: 'payments', doc, increaseCents: 0, decreaseCents: paymentCents(doc) }))
    ].sort((a, b) => a.doc.date.localeCompare(b.doc.date) || a.doc.sequence - b.doc.sequence || a.doc.id.localeCompare(b.doc.id));
    return events.map(event => {
      const beforeCents = balance;
      balance = safe(BigInt(balance) + BigInt(event.increaseCents) - BigInt(event.decreaseCents));
      return { ...event, beforeCents, balanceCents: balance };
    });
  }
  function statement(state, supplierId, start, end) {
    date(start); date(end);
    if (start > end) throw new Error('开始日期不能晚于结束日期。');
    const supplier = state.suppliers.find(s => s.id === supplierId);
    if (!supplier) throw new Error('请选择供应商。');
    if (start < supplier.openingDate) throw new Error('查询开始日期不能早于供应商期初起算日期。');
    const events = ledger(state, supplierId);
    let openingCents = cents(supplier.openingAmount, '期初欠款', true);
    for (const row of events) if (row.doc.date < start) openingCents = row.balanceCents;
    const rows = events.filter(row => row.doc.date >= start && row.doc.date <= end);
    return { openingCents, rows, closingCents: rows.length ? rows.at(-1).balanceCents : openingCents };
  }
  function paymentBalance(state, id) {
    const doc = state.payments.find(p => p.id === id);
    if (!doc || doc.voided) throw new Error('有效付款单不存在。');
    const row = ledger(state, doc.supplierId).find(r => r.type === 'payments' && r.doc.id === id);
    return { beforeCents: row.beforeCents, afterCents: row.balanceCents };
  }
  function supplierBalance(state, supplierId, end) {
    date(end);
    const supplier = state.suppliers.find(s => s.id === supplierId);
    if (!supplier) throw new Error('供应商不存在。');
    if (end < supplier.openingDate) return null;
    return statement(state, supplierId, supplier.openingDate, end).closingCents;
  }
  function merge(state, backup) {
    if (!backup || backup.format !== 'material-management' || backup.version !== 1) throw new Error('不是本工具的材料管理备份。');
    validate(backup.state);
    const next = copy(state);
    for (const key of collections) for (const doc of backup.state[key]) {
      const existing = next[key].find(d => d.id === doc.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(doc)) throw new Error('同编号记录存在冲突，已取消恢复；请核对备份版本。');
      if (!existing) next[key].push(copy(doc));
    }
    return validate(next);
  }
  global.MaterialDomain = Object.freeze({ empty, validate, save, voidDocument, remaining, relatedReceipts, receiptTotals, paymentCents, statement, paymentBalance, supplierBalance, merge, cents });
})(typeof window === 'undefined' ? globalThis : window);
