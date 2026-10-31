/**
 * ============================================================
 *  script.js — KasRantau Application Logic
 *  Arsitektur Tiga Layer:
 *    DATA LAYER        : Membaca CSV, localStorage read/write
 *    APPLICATION LAYER : Logika filter, kalkulasi, pencarian
 *    PRESENTATION LAYER: Render DOM, chart, KPI
 * ============================================================
 */

'use strict';

// ============================================================
// ██████  DATA LAYER
// Tanggung jawab: sumber data (CSV & localStorage), CRUD
// ============================================================

/** Key untuk menyimpan data di localStorage */
const STORAGE_KEY = 'kasrantau_transactions';

/** Nama file CSV sebagai sumber data awal */
const CSV_FILE = 'keuangan_oktober_2026.csv';

/**
 * Membaca transaksi dari localStorage.
 * Mengembalikan array transaksi (bisa kosong []).
 */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Menyimpan array transaksi ke localStorage.
 * @param {Array} transactions
 */
function saveToStorage(transactions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

/**
 * Mengambil data dari file CSV menggunakan Fetch API + Papa Parse.
 * Hanya dijalankan saat localStorage kosong (data awal).
 * @returns {Promise<Array>} array transaksi terformat
 */
async function fetchCSV() {
  const response = await fetch(CSV_FILE);
  if (!response.ok) throw new Error('Gagal memuat file CSV.');
  const text = await response.text();

  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,         // baris pertama sebagai key objek
      skipEmptyLines: true,
      complete(results) {
        // Normalisasi tipe data dari CSV (semua string → konversi)
        const transactions = results.data.map(row => ({
          id:       String(row.id),
          name:     row.name,
          type:     row.type,       // 'income' | 'expense'
          category: row.category,
          amount:   Number(row.amount),
          date:     row.date,       // format 'YYYY-MM-DD'
        }));
        resolve(transactions);
      },
      error(err) {
        reject(err);
      }
    });
  });
}

/**
 * Menghasilkan ID unik untuk transaksi baru.
 * @returns {string}
 */
function generateId() {
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Menambah transaksi baru ke array + simpan ke storage.
 * @param {Array} transactions - array data aktif
 * @param {Object} newTx
 * @returns {Array} array terbaru
 */
function addTransaction(transactions, newTx) {
  const updated = [newTx, ...transactions]; // terbaru di atas
  saveToStorage(updated);
  return updated;
}

/**
 * Menghapus transaksi berdasarkan ID.
 * @param {Array} transactions
 * @param {string} id
 * @returns {Array} array terbaru
 */
function deleteTransaction(transactions, id) {
  const updated = transactions.filter(tx => tx.id !== id);
  saveToStorage(updated);
  return updated;
}


// ============================================================
// ██████  APPLICATION LAYER
// Tanggung jawab: filter, pencarian, kalkulasi KPI, agregasi
// ============================================================

/**
 * Mengambil daftar bulan unik dari array transaksi.
 * Format: 'YYYY-MM'
 * @param {Array} transactions
 * @returns {Array<string>} terurut ascending
 */
function getUniqueMonths(transactions) {
  const months = new Set(transactions.map(tx => tx.date.slice(0, 7)));
  return [...months].sort();
}

/**
 * Mem-filter transaksi berdasarkan kriteria aktif.
 * @param {Array} transactions
 * @param {Object} filters { type, category, month, search }
 * @returns {Array}
 */
function applyFilters(transactions, filters) {
  return transactions.filter(tx => {
    // Filter jenis (income / expense)
    if (filters.type && tx.type !== filters.type) return false;
    // Filter kategori
    if (filters.category && tx.category !== filters.category) return false;
    // Filter bulan (format 'YYYY-MM')
    if (filters.month && !tx.date.startsWith(filters.month)) return false;
    // Filter pencarian (nama transaksi, case-insensitive)
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!tx.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

/**
 * Menghitung KPI dari array transaksi terfilter.
 * @param {Array} transactions
 * @returns {{ income, expense, balance, total, incomeCount, expenseCount }}
 */
function calcKPI(transactions) {
  let income = 0, expense = 0, incomeCount = 0, expenseCount = 0;
  for (const tx of transactions) {
    if (tx.type === 'income') {
      income += tx.amount;
      incomeCount++;
    } else {
      expense += tx.amount;
      expenseCount++;
    }
  }
  return {
    income,
    expense,
    balance: income - expense,
    total: transactions.length,
    incomeCount,
    expenseCount,
  };
}

/**
 * Mengelompokkan pengeluaran per kategori untuk Doughnut Chart.
 * @param {Array} transactions (sudah difilter)
 * @returns {{ labels: string[], data: number[] }}
 */
function groupExpenseByCategory(transactions) {
  const map = {};
  transactions
    .filter(tx => tx.type === 'expense')
    .forEach(tx => {
      map[tx.category] = (map[tx.category] || 0) + tx.amount;
    });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return {
    labels: sorted.map(([k]) => k),
    data:   sorted.map(([, v]) => v),
  };
}

/**
 * Mengelompokkan pemasukan & pengeluaran per bulan untuk Bar Chart.
 * Menggunakan SEMUA transaksi (tanpa filter bulan) agar grafik bulanan
 * selalu lengkap meskipun filter bulan aktif.
 * @param {Array} allTransactions - semua data tanpa filter bulan
 * @returns {{ labels, incomeData, expenseData }}
 */
function groupByMonth(allTransactions) {
  const map = {};
  allTransactions.forEach(tx => {
    const month = tx.date.slice(0, 7); // 'YYYY-MM'
    if (!map[month]) map[month] = { income: 0, expense: 0 };
    if (tx.type === 'income') map[month].income += tx.amount;
    else map[month].expense += tx.amount;
  });
  const labels = Object.keys(map).sort();
  return {
    labels:      labels.map(m => formatMonthLabel(m)),
    incomeData:  labels.map(m => map[m].income),
    expenseData: labels.map(m => map[m].expense),
  };
}

// ============================================================
// ██████  PRESENTATION LAYER
// Tanggung jawab: render UI, chart, event listener
// ============================================================

// ---------- State Aplikasi ----------
let allTransactions = [];   // sumber kebenaran (semua data)
let chartDoughnut   = null; // instance Chart.js
let chartBar        = null; // instance Chart.js

// Objek filter aktif
const activeFilters = {
  type:     '',
  category: '',
  month:    '',
  search:   '',
};

// ---------- Helpers Format ----------

/**
 * Format angka ke Rupiah singkat: 1.500.000 → "Rp 1.500.000"
 * @param {number} num
 * @returns {string}
 */
function formatRupiah(num) {
  return 'Rp ' + num.toLocaleString('id-ID');
}

/**
 * Format 'YYYY-MM' ke label bulan Indonesia, cth: "Oktober 2026"
 * @param {string} ym
 * @returns {string}
 */
function formatMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${bulan[parseInt(m, 10) - 1]} ${y}`;
}

/**
 * Format 'YYYY-MM-DD' ke tanggal Indonesia, cth: "1 Oktober 2026"
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateID(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const bulan = ['Januari','Februari','Maret','April','Mei','Juni',
                 'Juli','Agustus','September','Oktober','November','Desember'];
  return `${parseInt(d, 10)} ${bulan[parseInt(m, 10) - 1]} ${y}`;
}

/**
 * Emoji ikon per kategori transaksi.
 * @param {string} category
 * @returns {string}
 */
function categoryIcon(category) {
  const icons = {
    'Makanan dan Minuman': '🍜',
    'Transportasi':        '🚌',
    'Kos dan Tagihan':     '🏠',
    'Kebutuhan Kuliah':    '📚',
    'Hiburan':             '🎬',
    'Kesehatan':           '💊',
    'Uang Bulanan':        '💵',
    'Pemasukan Tambahan':  '💼',
    'Beasiswa':            '🎓',
    'Lainnya':             '📦',
  };
  return icons[category] || '📌';
}

// ---------- Render KPI ----------

/**
 * Memperbarui tampilan 4 kartu KPI berdasarkan data terfilter.
 * @param {Object} kpi - hasil calcKPI()
 */
function renderKPI(kpi) {
  document.getElementById('kpi-income').textContent   = formatRupiah(kpi.income);
  document.getElementById('kpi-expense').textContent  = formatRupiah(kpi.expense);
  document.getElementById('kpi-total').textContent    = kpi.total;
  document.getElementById('kpi-income-count').textContent  = `${kpi.incomeCount} transaksi`;
  document.getElementById('kpi-expense-count').textContent = `${kpi.expenseCount} transaksi`;

  // Saldo: warna beda tergantung positif/negatif
  const balanceEl = document.getElementById('kpi-balance');
  balanceEl.textContent = formatRupiah(kpi.balance);
  balanceEl.className   = 'text-2xl font-bold ' + (kpi.balance >= 0 ? 'balance-positive' : 'balance-negative');
}

// ---------- Render Daftar Transaksi ----------

/**
 * Me-render seluruh daftar transaksi ke dalam DOM.
 * @param {Array} transactions - hasil applyFilters()
 */
function renderTransactionList(transactions) {
  const container  = document.getElementById('transaction-list');
  const emptyState = document.getElementById('empty-state');

  if (transactions.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  // Render setiap baris transaksi
  container.innerHTML = transactions.map(tx => {
    const isIncome   = tx.type === 'income';
    const amountText = (isIncome ? '+' : '-') + ' ' + formatRupiah(tx.amount);
    const amountCls  = isIncome ? 'text-brand-600 font-bold' : 'text-red-500 font-bold';
    const icon       = categoryIcon(tx.category);

    return `
      <div class="transaction-row row-enter flex items-center justify-between gap-3
                  border border-gray-100 rounded-xl px-4 py-3"
           data-id="${tx.id}">
        <!-- Kiri: ikon + info -->
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <span class="text-2xl flex-shrink-0 mt-0.5">${icon}</span>
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-800 truncate">${tx.name}</p>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              <span class="badge-category">${tx.category}</span>
              <span class="text-xs text-gray-400">${formatDateID(tx.date)}</span>
            </div>
          </div>
        </div>
        <!-- Kanan: nominal + hapus -->
        <div class="flex items-center gap-3 flex-shrink-0">
          <span class="${amountCls} text-sm">${amountText}</span>
          <button class="btn-delete rounded-lg p-1.5 text-gray-300"
                  data-id="${tx.id}" aria-label="Hapus transaksi">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Delegasi event untuk tombol hapus
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', handleDelete);
  });
}

// ---------- Render Charts ----------

/** Palet warna untuk Doughnut Chart */
const DOUGHNUT_COLORS = [
  '#22c55e','#0ea5e9','#f97316','#a855f7','#ec4899',
  '#eab308','#14b8a6','#f43f5e','#6366f1','#94a3b8',
];

/**
 * Membuat atau memperbarui Doughnut Chart pengeluaran per kategori.
 * @param {{ labels, data }} chartData
 */
function renderDoughnutChart(chartData) {
  const ctx = document.getElementById('chart-doughnut').getContext('2d');

  if (chartDoughnut) {
    // Update data tanpa membuat ulang instance (lebih hemat)
    chartDoughnut.data.labels         = chartData.labels;
    chartDoughnut.data.datasets[0].data = chartData.data;
    chartDoughnut.update();
    return;
  }

  chartDoughnut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartData.labels,
      datasets: [{
        data:            chartData.data,
        backgroundColor: DOUGHNUT_COLORS,
        borderWidth:     2,
        borderColor:     '#ffffff',
        hoverOffset:     6,
      }]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 10 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${formatRupiah(ctx.parsed)}`
          }
        }
      }
    }
  });
}

/**
 * Membuat atau memperbarui Bar Chart pemasukan vs pengeluaran bulanan.
 * @param {{ labels, incomeData, expenseData }} chartData
 */
function renderBarChart(chartData) {
  const ctx = document.getElementById('chart-bar').getContext('2d');

  if (chartBar) {
    chartBar.data.labels                = chartData.labels;
    chartBar.data.datasets[0].data      = chartData.incomeData;
    chartBar.data.datasets[1].data      = chartData.expenseData;
    chartBar.update();
    return;
  }

  chartBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: chartData.labels,
      datasets: [
        {
          label:           'Pemasukan',
          data:            chartData.incomeData,
          backgroundColor: 'rgba(34, 197, 94, 0.75)',
          borderRadius:    6,
          borderSkipped:   false,
        },
        {
          label:           'Pengeluaran',
          data:            chartData.expenseData,
          backgroundColor: 'rgba(239, 68, 68, 0.75)',
          borderRadius:    6,
          borderSkipped:   false,
        }
      ]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 10 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${formatRupiah(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: val => 'Rp ' + (val >= 1_000_000
              ? (val / 1_000_000).toFixed(1) + 'jt'
              : val.toLocaleString('id-ID')),
            font: { size: 10 }
          },
          grid: { color: '#f1f5f9' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 } }
        }
      }
    }
  });
}

// ---------- Header Period ----------

/**
 * Menampilkan periode aktif di header (contoh: "Oktober 2026").
 */
function renderHeaderPeriod() {
  const el = document.getElementById('header-period');
  if (activeFilters.month) {
    el.textContent = formatMonthLabel(activeFilters.month);
  } else if (allTransactions.length > 0) {
    // Ambil rentang bulan dari semua data
    const months = getUniqueMonths(allTransactions);
    if (months.length === 1) {
      el.textContent = formatMonthLabel(months[0]);
    } else {
      el.textContent = `${formatMonthLabel(months[0])} – ${formatMonthLabel(months[months.length - 1])}`;
    }
  } else {
    el.textContent = '';
  }
}

// ---------- Populate Filter Bulan ----------

/**
 * Mengisi dropdown filter bulan berdasarkan data yang tersedia.
 */
function populateMonthFilter() {
  const select = document.getElementById('filter-month');
  const months = getUniqueMonths(allTransactions);
  // Hapus option lama kecuali "Semua Bulan"
  select.innerHTML = '<option value="">Semua Bulan</option>';
  months.forEach(m => {
    const opt = document.createElement('option');
    opt.value       = m;
    opt.textContent = formatMonthLabel(m);
    select.appendChild(opt);
  });
  // Pulihkan nilai filter bulan yang sudah dipilih
  select.value = activeFilters.month;
}

// ---------- Fungsi Utama Refresh UI ----------

/**
 * Fungsi pusat yang memperbarui SELURUH UI:
 * KPI, daftar transaksi, dan kedua chart.
 * Dipanggil setiap kali data atau filter berubah.
 */
function refreshUI() {
  // Terapkan filter ke semua data
  const filtered = applyFilters(allTransactions, activeFilters);

  // KPI berdasarkan data terfilter
  const kpi = calcKPI(filtered);
  renderKPI(kpi);

  // Daftar transaksi
  renderTransactionList(filtered);

  // Doughnut Chart: pengeluaran per kategori (terfilter)
  const doughnutData = groupExpenseByCategory(filtered);
  renderDoughnutChart(doughnutData);

  // Bar Chart: seluruh data (tidak terpengaruh filter bulan tunggal)
  // agar grafik bulanan tetap tampil lengkap
  const barData = groupByMonth(allTransactions);
  renderBarChart(barData);

  // Header periode
  renderHeaderPeriod();
}

// ---------- Event Handlers ----------

/**
 * Menangani submit form tambah transaksi.
 * @param {Event} e
 */
function handleFormSubmit(e) {
  e.preventDefault();

  const name     = document.getElementById('f-name').value.trim();
  const amount   = parseFloat(document.getElementById('f-amount').value);
  const category = document.getElementById('f-category').value;
  const date     = document.getElementById('f-date').value;
  const typeEl   = document.querySelector('input[name="f-type"]:checked');
  const errorEl  = document.getElementById('form-error');

  // Validasi sederhana
  if (!name || !amount || !category || !date || !typeEl) {
    errorEl.textContent = 'Harap lengkapi semua kolom sebelum menyimpan.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (amount <= 0) {
    errorEl.textContent = 'Nominal harus lebih dari 0.';
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  // Buat objek transaksi baru
  const newTx = {
    id:       generateId(),
    name,
    type:     typeEl.value,
    category,
    amount,
    date,
  };

  // Simpan ke data layer
  allTransactions = addTransaction(allTransactions, newTx);

  // Perbarui dropdown filter bulan (jika bulan baru)
  populateMonthFilter();

  // Refresh seluruh UI
  refreshUI();

  // Reset form
  e.target.reset();
}

/**
 * Menangani klik tombol hapus transaksi.
 * @param {Event} e
 */
function handleDelete(e) {
  const id = e.currentTarget.getAttribute('data-id');
  if (!id) return;
  if (!confirm('Hapus transaksi ini?')) return;

  allTransactions = deleteTransaction(allTransactions, id);
  populateMonthFilter();
  refreshUI();
}

/**
 * Menangani perubahan filter jenis, kategori, bulan, dan pencarian.
 */
function handleFilterChange() {
  activeFilters.type     = document.getElementById('filter-type').value;
  activeFilters.category = document.getElementById('filter-category').value;
  activeFilters.month    = document.getElementById('filter-month').value;
  activeFilters.search   = document.getElementById('search-input').value.trim();
  refreshUI();
}

/**
 * Mereset semua filter ke kondisi awal.
 */
function handleResetFilter() {
  document.getElementById('filter-type').value     = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-month').value    = '';
  document.getElementById('search-input').value    = '';
  activeFilters.type     = '';
  activeFilters.category = '';
  activeFilters.month    = '';
  activeFilters.search   = '';
  refreshUI();
}

// ---------- Bootstrap / Inisialisasi Aplikasi ----------

/**
 * Inisialisasi aplikasi:
 * 1. Cek localStorage → pakai jika ada
 * 2. Jika tidak → ambil dari CSV
 * 3. Pasang semua event listener
 * 4. Render UI pertama kali
 */
async function initApp() {
  // Set default tanggal form ke hari ini
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('f-date').value = today;

  // --- DATA LAYER: cek localStorage terlebih dahulu ---
  const stored = loadFromStorage();
  if (stored && stored.length > 0) {
    // Gunakan data dari localStorage (perubahan pengguna tidak tertimpa)
    allTransactions = stored;
  } else {
    // Pertama kali: ambil dari file CSV
    try {
      allTransactions = await fetchCSV();
      saveToStorage(allTransactions); // cache ke localStorage
    } catch (err) {
      console.error('Gagal memuat CSV:', err);
      allTransactions = [];
    }
  }

  // --- Isi dropdown filter bulan ---
  populateMonthFilter();

  // --- Pasang event listener ---
  document.getElementById('form-transaction')
    .addEventListener('submit', handleFormSubmit);

  document.getElementById('filter-type')
    .addEventListener('change', handleFilterChange);

  document.getElementById('filter-category')
    .addEventListener('change', handleFilterChange);

  document.getElementById('filter-month')
    .addEventListener('change', handleFilterChange);

  // Pencarian real-time saat mengetik
  document.getElementById('search-input')
    .addEventListener('input', handleFilterChange);

  document.getElementById('btn-reset-filter')
    .addEventListener('click', handleResetFilter);

  // --- Render pertama kali ---
  refreshUI();
}

// Mulai aplikasi setelah DOM siap
document.addEventListener('DOMContentLoaded', initApp);
