'use strict';
const assert = require('node:assert/strict');
require('../preview-site/material-domain.js');
const M = global.MaterialDomain;
let s = M.empty();
s = M.save(s, 'suppliers', { id: 's1', name: '测试供应商', openingDate: '2026-10-01', openingAmount: '1000.00' });
s = M.save(s, 'suppliers', { id: 's2', name: '另一供应商', openingDate: '2026-10-01', openingAmount: '0' });
s = M.save(s, 'orders', { id: 'o1', supplierId: 's1', date: '2026-10-01', note: '', lines: [
  { id: 'l1', material: '201', spec: '0.3×600', quantity: 10, price: '12.5', product: '圆片', note: '' },
  { id: 'l2', material: '304', spec: '0.5×600', quantity: 5, price: '20', product: '', note: '' }
] });
const receipt = (id, quantity, date = '2026-10-02') => ({ id, supplierId: 's1', date, note: '', lines: [
  { id: id + 'line', orderId: 'o1', orderLineId: 'l1', material: '201', spec: '0.3×600', quantity, weights: ['10.125', '20.375'], price: '12.5', progress: '待加工' }
] });
s = M.save(s, 'receipts', receipt('r1', 4));
s = M.save(s, 'receipts', receipt('r2', 3, '2026-10-04'));
assert.equal(M.remaining(s, 'o1', 'l1'), 3);
assert.equal(M.relatedReceipts(s, 'o1').length, 2);
assert.equal(M.relatedReceipts(s, 'o1')[0].quantity, 4);
assert.equal(M.receiptTotals(s.receipts[0]).weight, 30.5);
assert.equal(M.receiptTotals(s.receipts[0]).cents, 38125);
assert.throws(() => M.save(s, 'receipts', receipt('r3', 4)), /超出/);
assert.throws(() => M.save(s, 'receipts', { ...receipt('bad', 1), supplierId: 's2' }), /供应商/);
assert.throws(() => M.save(s, 'receipts', { ...receipt('early', 1), date: '2026-09-30' }), /起算|订货日期/);
assert.throws(() => M.save(s, 'receipts', { ...receipt('bad', 1), lines: [{ ...receipt('bad', 1).lines[0], weights: ['0'] }] }), /重量/);
s = M.save(s, 'payments', { id: 'p1', supplierId: 's1', date: '2026-10-03', repayment: '200', discount: '10', note: '退差' });
let report = M.statement(s, 's1', '2026-10-03', '2026-10-04');
assert.equal(report.openingCents, 138125);
assert.equal(report.rows.length, 2);
assert.equal(report.closingCents, 155250);
assert.equal(report.rows[0].balanceCents, 117125);
assert.equal(M.paymentBalance(s, 'p1').beforeCents, 138125);
assert.equal(M.paymentBalance(s, 'p1').afterCents, 117125);
assert.throws(() => M.voidDocument(s, 'orders', 'o1'), /收货/);
s = M.voidDocument(s, 'receipts', 'r1');
assert.equal(M.relatedReceipts(s, 'o1').filter(r => r.doc.voided).length, 1);
assert.equal(M.remaining(s, 'o1', 'l1'), 7);
assert.equal(M.statement(s, 's1', '2026-10-01', '2026-10-04').closingCents, 117125);
s = M.save(s, 'receipts', { ...receipt('r2', 5, '2026-10-04') });
assert.equal(M.remaining(s, 'o1', 'l1'), 5);
const rounded = M.receiptTotals({ lines: [{ weights: ['0.333'], price: '0.015' }, { weights: ['0.333'], price: '0.015' }] });
assert.equal(rounded.cents, 0); // 每行四舍五入到分后汇总
assert.equal(M.receiptTotals({ lines: [{ weights: ['1.005'], price: '1' }] }).cents, 101);
assert.throws(() => M.save(s, 'payments', { id: 'zero', supplierId: 's1', date: '2026-10-04', repayment: '-1', discount: '0' }), /还款/);
assert.throws(() => M.save(s, 'suppliers', { ...s.suppliers[0], name: '另一供应商' }), /重复/);
assert.throws(() => M.statement(s, 's1', '2026-09-01', '2026-10-04'), /起算/);
assert.throws(() => M.statement(s, 's1', '2026-10-05', '2026-10-04'), /日期/);
assert.throws(() => M.statement(s, 's1', '2026-13-01', '2026-13-02'), /日期/);
const backup = { format: 'material-management', version: 1, state: s };
assert.deepEqual(M.merge(M.empty(), backup), s);
assert.deepEqual(M.merge(s, backup), s);
assert.throws(() => M.merge(s, { ...backup, state: { ...s, suppliers: [{ ...s.suppliers[0], name: '冲突' }] } }), /冲突/);
assert.throws(() => M.validate({ ...s, receipts: [...s.receipts, s.receipts[0]] }), /重复/);
let mixed = M.save(s, 'orders', { ...s.orders[0], id: 'o2', lines: [{ ...s.orders[0].lines[0], id: 'other-line' }] });
assert.deepEqual(M.relatedReceipts(mixed, 'o2'), []);
mixed = M.save(mixed, 'receipts', { id: 'mixed', supplierId: 's1', date: '2026-10-05', note: '', lines: [
  { id: 'mixed1', orderId: 'o1', orderLineId: 'l2', material: '304', spec: '0.5×600', quantity: 1, weights: ['2'], price: '20', progress: '' },
  { id: 'mixed2', orderId: 'o2', orderLineId: 'other-line', material: '201', spec: '0.3×600', quantity: 2, weights: ['3'], price: '12.5', progress: '' },
  { id: 'mixed3', orderId: 'o1', orderLineId: 'l1', material: '201', spec: '0.3×600', quantity: 1, weights: ['4'], price: '12.5', progress: '' }
] });
const related = M.relatedReceipts(mixed, 'o1').find(r => r.doc.id === 'mixed');
assert.equal(related.lines.length, 2);
assert.equal(related.quantity, 2);
assert.equal(related.weight, 6);
assert.equal(related.cents, 9000);
assert.equal(M.receiptTotals(related.doc).cents, 12750);
assert.equal(M.relatedReceipts(mixed, 'o1').length, 3); // 同一收货单的多个关联明细只出现一张单据
assert.throws(() => M.relatedReceipts(mixed, 'missing'), /不存在/);
console.log('材料业务验证通过：关联扣减、多捆重量、精确金额、跨期余额、编辑作废、恢复校验。');
