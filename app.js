/* ── Storage ── */
const KEY_MERCHANTS = 'upi_entries';
const KEY_BILLS     = 'upi_bills';

let merchants = JSON.parse(localStorage.getItem(KEY_MERCHANTS) || '[]');
let bills     = JSON.parse(localStorage.getItem(KEY_BILLS)     || '[]');
let editingId = null;
let deferredPrompt = null;
let pendingBill = null;       // bill waiting for Paid / Open confirmation
let reportStatusFilter = 'all';

function saveMerchants() { localStorage.setItem(KEY_MERCHANTS, JSON.stringify(merchants)); }
function saveBills()     { localStorage.setItem(KEY_BILLS,     JSON.stringify(bills));     }

/* ════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════ */
const pageTitles = {
  pageMerchants: ['Merchants',  'Manage UPI merchant details'],
  pageBill:      ['Bill',       'Create & send a payment QR'],
  pageReport:    ['Report',     'View and manage transactions'],
};

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(target).classList.add('active');
    btn.classList.add('active');
    const [title, sub] = pageTitles[target];
    document.getElementById('pageTitle').textContent    = title;
    document.getElementById('pageSubtitle').textContent = sub;
    if (target === 'pageBill')   populateMerchantSelect();
    if (target === 'pageReport') resetReport();
  });
});

/* ════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════ */
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 2600);
}

/* ════════════════════════════════════════════
   MERCHANTS PAGE
═══════════════════════════════════════════════ */
const upiInput  = document.getElementById('upiId');
const codeInput = document.getElementById('merchantCode');
const nameInput = document.getElementById('merchantName');
const saveBtn   = document.getElementById('saveBtn');
const editBtn   = document.getElementById('editBtn');

function setFormEnabled(enabled) {
  [upiInput, codeInput, nameInput].forEach(el => el.disabled = !enabled);
}

function clearForm() {
  upiInput.value = codeInput.value = nameInput.value = '';
  setFormEnabled(true);   // always enable for new entry
  editingId = null;
  saveBtn.disabled = false;
  editBtn.disabled = true;
  editBtn.textContent = '✏️ Edit';
  document.querySelectorAll('.entry-item').forEach(el => el.classList.remove('active'));
}

function renderMerchants() {
  document.getElementById('countBadge').textContent = merchants.length;
  const list = document.getElementById('entryList');
  if (!merchants.length) {
    list.innerHTML = '<p class="empty-state">No merchants yet. Add one above.</p>';
    return;
  }
  list.innerHTML = merchants.map(e => `
    <div class="entry-item ${editingId === e.id ? 'active' : ''}" data-id="${e.id}">
      <div class="entry-avatar">${e.name.charAt(0).toUpperCase()}</div>
      <div class="entry-info">
        <div class="entry-name">${e.name}</div>
        <div class="entry-upi">${e.upi}</div>
        <div class="entry-code">Code: ${e.code || '—'}</div>
      </div>
      <button class="btn-delete" data-id="${e.id}" title="Delete">🗑</button>
    </div>
  `).join('');

  list.querySelectorAll('.entry-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.btn-delete')) return;
      loadMerchant(el.dataset.id);
    });
  });
  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteMerchant(btn.dataset.id));
  });
}

function loadMerchant(id) {
  const m = merchants.find(e => e.id === id);
  if (!m) return;
  editingId = id;
  upiInput.value  = m.upi;
  codeInput.value = m.code;
  nameInput.value = m.name;
  setFormEnabled(false);   // read-only until Edit clicked
  saveBtn.disabled = true;
  editBtn.disabled = false;
  editBtn.textContent = '✏️ Edit';
  renderMerchants();
}

function deleteMerchant(id) {
  if (!confirm('Delete this merchant?')) return;
  merchants = merchants.filter(e => e.id !== id);
  saveMerchants();
  if (editingId === id) clearForm();
  renderMerchants();
  toast('Merchant deleted');
}

saveBtn.addEventListener('click', () => {
  const upi  = upiInput.value.trim();
  const code = codeInput.value.trim();
  const name = nameInput.value.trim();
  if (!upi || !name) { toast('UPI ID and Merchant Name are required', 'error'); return; }
  if (editingId) {
    merchants[merchants.findIndex(e => e.id === editingId)] = { id: editingId, upi, code, name };
    toast('Merchant updated');
  } else {
    merchants.push({ id: Date.now().toString(), upi, code, name });
    toast('Merchant saved');
  }
  saveMerchants();
  clearForm();
  renderMerchants();
});

editBtn.addEventListener('click', () => {
  if (!editingId) return;
  const enabling = upiInput.disabled;
  setFormEnabled(enabling);
  saveBtn.disabled = !enabling;
  editBtn.textContent = enabling ? '✖ Cancel Edit' : '✏️ Edit';
  if (!enabling) { setFormEnabled(false); saveBtn.disabled = true; editBtn.textContent = '✏️ Edit'; }
});

/* ════════════════════════════════════════════
   BILL PAGE
═══════════════════════════════════════════════ */
const billMerchantSel = document.getElementById('billMerchant');
const quickNums       = document.getElementById('quickNums');
const calcBtn         = document.getElementById('calcBtn');
const billAmountInput = document.getElementById('billAmount');
const billDateInput   = document.getElementById('billDate');
const generateQRBtn   = document.getElementById('generateQR');
const qrCard          = document.getElementById('qrCard');
const qrCanvas        = document.getElementById('qrCanvas');
const qrMeta          = document.getElementById('qrMeta');
const saveAsPaidBtn   = document.getElementById('saveAsPaid');
const saveAsOpenBtn   = document.getElementById('saveAsOpen');
const discardBillBtn  = document.getElementById('discardBill');

function todayStr() { return new Date().toISOString().split('T')[0]; }
billDateInput.value = todayStr();

function populateMerchantSelect() {
  const cur = billMerchantSel.value;
  billMerchantSel.innerHTML = '<option value="">— choose a merchant —</option>' +
    merchants.map(m => `<option value="${m.id}"${m.id === cur ? ' selected' : ''}>${m.name} (${m.upi})</option>`).join('');
}

calcBtn.addEventListener('click', () => {
  const nums = quickNums.value.split(/[\s,]+/).map(s => parseFloat(s)).filter(n => !isNaN(n) && n > 0);
  if (!nums.length) { toast('No valid numbers found', 'error'); return; }
  const total = nums.reduce((a, b) => a + b, 0);
  billAmountInput.value = parseFloat(total.toFixed(2));
  toast(`Sum of ${nums.length} numbers = ₹${total.toFixed(2)}`);
});

function buildUpiUrl(m, amount) {
  return `upi://pay?pa=${encodeURIComponent(m.upi)}&pn=${encodeURIComponent(m.name)}` +
    (m.code ? `&mc=${encodeURIComponent(m.code)}` : '') +
    `&am=${amount.toFixed(2)}&cu=INR`;
}

function renderQR(container, upiUrl) {
  container.innerHTML = '';
  new QRCode(container, {
    text: upiUrl, width: 220, height: 220,
    colorDark: '#000000', colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

generateQRBtn.addEventListener('click', () => {
  const merchantId = billMerchantSel.value;
  const amount     = parseFloat(billAmountInput.value);
  const date       = billDateInput.value || todayStr();
  if (!merchantId) { toast('Select a merchant first', 'error'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }

  const m = merchants.find(e => e.id === merchantId);
  if (!m) return;

  const upiUrl = buildUpiUrl(m, amount);
  renderQR(qrCanvas, upiUrl);

  qrMeta.innerHTML = `<strong>${m.name}</strong><br>${m.upi}${m.code ? ' · ' + m.code : ''}<br>Amount: <strong style="color:#22c55e">₹${amount.toFixed(2)}</strong>`;
  qrCard.style.display = 'block';
  qrCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  /* Store pending bill — awaiting Paid / Open confirmation */
  pendingBill = { merchantId: m.id, merchantName: m.name, upi: m.upi, code: m.code, amount, date, upiUrl };
});

function commitBill(status) {
  if (!pendingBill) return;
  bills.push({ id: Date.now().toString(), ...pendingBill, status });
  saveBills();
  toast(status === 'paid' ? `✅ Saved as Paid — ₹${pendingBill.amount.toFixed(2)}` : `🕐 Saved as Open — ₹${pendingBill.amount.toFixed(2)}`,
        status === 'paid' ? 'success' : 'warn');
  pendingBill = null;
  billAmountInput.value = '';
  quickNums.value = '';
  qrCard.style.display = 'none';
}

saveAsPaidBtn.addEventListener('click', () => commitBill('paid'));
saveAsOpenBtn.addEventListener('click', () => commitBill('open'));
discardBillBtn.addEventListener('click', () => {
  pendingBill = null;
  qrCard.style.display = 'none';
});

/* ════════════════════════════════════════════
   REPORT PAGE
═══════════════════════════════════════════════ */
const fromDateInput     = document.getElementById('fromDate');
const toDateInput       = document.getElementById('toDate');
const filterBtn         = document.getElementById('filterBtn');
const reportSummaryCard = document.getElementById('reportSummaryCard');
const reportListCard    = document.getElementById('reportListCard');
const reportList        = document.getElementById('reportList');
const statCount         = document.getElementById('statCount');
const statOpen          = document.getElementById('statOpen');
const statPaid          = document.getElementById('statPaid');
const selectAllChk      = document.getElementById('selectAll');
const deleteSelectedBtn = document.getElementById('deleteSelected');

let filteredBills = [];

/* Status filter tabs */
document.querySelectorAll('.stab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    reportStatusFilter = tab.dataset.status;
  });
});

function resetReport() {
  reportSummaryCard.style.display = 'none';
  reportListCard.style.display    = 'none';
  fromDateInput.value = todayStr();
  toDateInput.value   = todayStr();
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function renderReport(filtered) {
  filteredBills = filtered;
  const openTotal = filtered.filter(b => b.status !== 'paid').reduce((s, b) => s + b.amount, 0);
  const paidTotal = filtered.filter(b => b.status === 'paid').reduce((s, b) => s + b.amount, 0);
  statCount.textContent = filtered.length;
  statOpen.textContent  = `₹${openTotal.toFixed(2)}`;
  statPaid.textContent  = `₹${paidTotal.toFixed(2)}`;
  reportSummaryCard.style.display = 'block';
  reportListCard.style.display    = 'block';
  selectAllChk.checked = false;

  if (!filtered.length) {
    reportList.innerHTML = '<p class="empty-state">No transactions in this range.</p>';
    return;
  }

  reportList.innerHTML = filtered.map(b => {
    const isPaid = b.status === 'paid';
    return `
    <div class="tx-item" data-id="${b.id}">
      <input type="checkbox" class="tx-check" data-id="${b.id}" />
      <div class="tx-info">
        <div class="tx-merchant">${b.merchantName}</div>
        <div class="tx-date">${formatDate(b.date)} · ${b.upi}</div>
      </div>
      <div class="tx-right">
        <span class="tx-amount">₹${b.amount.toFixed(2)}</span>
        <button class="status-pill ${isPaid ? 'paid' : 'open'}" data-id="${b.id}" title="Toggle status">
          ${isPaid ? '✅ Paid' : '🕐 Open'}
        </button>
      </div>
      <div class="tx-actions">
        <button class="tx-icon-btn qr-btn" data-id="${b.id}" title="View QR">📱</button>
        <button class="tx-icon-btn danger del-btn" data-id="${b.id}" title="Delete">🗑</button>
      </div>
    </div>`;
  }).join('');

  /* Checkbox */
  reportList.querySelectorAll('.tx-check').forEach(chk => {
    chk.addEventListener('change', () => {
      reportList.querySelector(`.tx-item[data-id="${chk.dataset.id}"]`).classList.toggle('selected', chk.checked);
      syncSelectAll();
    });
  });

  /* Status toggle */
  reportList.querySelectorAll('.status-pill').forEach(btn => {
    btn.addEventListener('click', () => toggleStatus(btn.dataset.id));
  });

  /* QR view */
  reportList.querySelectorAll('.qr-btn').forEach(btn => {
    btn.addEventListener('click', () => showQrModal(btn.dataset.id));
  });

  /* Delete */
  reportList.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteBill(btn.dataset.id));
  });
}

function syncSelectAll() {
  const checks = Array.from(reportList.querySelectorAll('.tx-check'));
  selectAllChk.checked = checks.length > 0 && checks.every(c => c.checked);
}

selectAllChk.addEventListener('change', () => {
  reportList.querySelectorAll('.tx-check').forEach(chk => {
    chk.checked = selectAllChk.checked;
    reportList.querySelector(`.tx-item[data-id="${chk.dataset.id}"]`).classList.toggle('selected', chk.checked);
  });
});

deleteSelectedBtn.addEventListener('click', () => {
  const ids = Array.from(reportList.querySelectorAll('.tx-check:checked')).map(c => c.dataset.id);
  if (!ids.length) { toast('Select at least one transaction', 'error'); return; }
  if (!confirm(`Delete ${ids.length} transaction(s)?`)) return;
  bills = bills.filter(b => !ids.includes(b.id));
  saveBills();
  toast(`${ids.length} transaction(s) deleted`);
  runFilter();
});

function deleteBill(id) {
  if (!confirm('Delete this transaction?')) return;
  bills = bills.filter(b => b.id !== id);
  saveBills();
  toast('Transaction deleted');
  runFilter();
}

function toggleStatus(id) {
  const bill = bills.find(b => b.id === id);
  if (!bill) return;
  bill.status = bill.status === 'paid' ? 'open' : 'paid';
  saveBills();
  toast(bill.status === 'paid' ? '✅ Marked as Paid' : '🕐 Marked as Open', bill.status === 'paid' ? 'success' : 'warn');
  runFilter();
}

function runFilter() {
  const from = fromDateInput.value;
  const to   = toDateInput.value;
  if (!from || !to) { toast('Select both dates', 'error'); return; }
  let filtered = bills.filter(b => b.date >= from && b.date <= to);
  if (reportStatusFilter === 'open') filtered = filtered.filter(b => b.status !== 'paid');
  if (reportStatusFilter === 'paid') filtered = filtered.filter(b => b.status === 'paid');
  filtered.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  renderReport(filtered);
}

filterBtn.addEventListener('click', runFilter);

/* ════════════════════════════════════════════
   QR MODAL (report)
═══════════════════════════════════════════════ */
const qrModal       = document.getElementById('qrModal');
const modalQrCanvas = document.getElementById('modalQrCanvas');
const modalQrMeta   = document.getElementById('modalQrMeta');
const closeModalBtn = document.getElementById('closeModal');

function showQrModal(id) {
  const bill = bills.find(b => b.id === id);
  if (!bill) return;
  const m = merchants.find(m => m.id === bill.merchantId);
  const upiUrl = bill.upiUrl || (m ? buildUpiUrl(m, bill.amount) : null);
  if (!upiUrl) { toast('Merchant data not found', 'error'); return; }

  renderQR(modalQrCanvas, upiUrl);
  const isPaid = bill.status === 'paid';
  modalQrMeta.innerHTML = `<strong>${bill.merchantName}</strong><br>${bill.upi}<br>` +
    `Amount: <strong style="color:#22c55e">₹${bill.amount.toFixed(2)}</strong><br>` +
    `Date: ${formatDate(bill.date)} · <span style="color:${isPaid ? '#22c55e' : '#f59e0b'}">${isPaid ? '✅ Paid' : '🕐 Open'}</span>`;
  qrModal.style.display = 'flex';
}

closeModalBtn.addEventListener('click', () => { qrModal.style.display = 'none'; });
qrModal.addEventListener('click', e => { if (e.target === qrModal) qrModal.style.display = 'none'; });

/* ════════════════════════════════════════════
   PWA INSTALL
═══════════════════════════════════════════════ */
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('installBanner').style.display = 'flex';
});
document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') document.getElementById('installBanner').style.display = 'none';
  deferredPrompt = null;
});

if ('serviceWorker' in navigator) {
  const swScope = location.pathname.includes('/upi-helper/') ? '/upi-helper/' : '/';
  navigator.serviceWorker.register('./sw.js', { scope: swScope }).catch(() => {});
}

/* ════════════════════════════════════════════
   THEME SWITCHER
═══════════════════════════════════════════════ */
const themeBtn   = document.getElementById('themeBtn');
const themePanel = document.getElementById('themePanel');

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('upi_theme', t);
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.theme === t));
}

themeBtn.addEventListener('click', e => {
  e.stopPropagation();
  themePanel.style.display = themePanel.style.display === 'none' ? 'block' : 'none';
});

document.querySelectorAll('.swatch').forEach(s => {
  s.addEventListener('click', () => {
    applyTheme(s.dataset.theme);
    themePanel.style.display = 'none';
  });
});

document.addEventListener('click', e => {
  if (!themePanel.contains(e.target) && e.target !== themeBtn) {
    themePanel.style.display = 'none';
  }
});

// Mark active swatch on load
applyTheme(localStorage.getItem('upi_theme') || 'dark');

/* ── Init ── */
clearForm();   // sets inputs enabled, buttons in correct state
renderMerchants();
