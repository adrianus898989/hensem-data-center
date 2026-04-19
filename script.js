const demoData = [
  { date: '2026-04-12', platform: '91CLUB', rechargeAmount: 125000, rechargeUsers: 312, withdrawAmount: 68000, withdrawUsers: 121, successCount: 540, failedCount: 28 },
  { date: '2026-04-13', platform: '91CLUB', rechargeAmount: 138500, rechargeUsers: 335, withdrawAmount: 72000, withdrawUsers: 126, successCount: 575, failedCount: 31 },
  { date: '2026-04-14', platform: 'BIGMUMBAI', rechargeAmount: 115000, rechargeUsers: 295, withdrawAmount: 61000, withdrawUsers: 112, successCount: 496, failedCount: 26 },
  { date: '2026-04-15', platform: 'BIGMUMBAI', rechargeAmount: 149800, rechargeUsers: 360, withdrawAmount: 79000, withdrawUsers: 130, successCount: 610, failedCount: 34 },
  { date: '2026-04-16', platform: 'JAI CLUB', rechargeAmount: 168000, rechargeUsers: 402, withdrawAmount: 95000, withdrawUsers: 156, successCount: 690, failedCount: 45 },
  { date: '2026-04-17', platform: 'JAI CLUB', rechargeAmount: 172000, rechargeUsers: 415, withdrawAmount: 98500, withdrawUsers: 162, successCount: 724, failedCount: 39 },
  { date: '2026-04-18', platform: 'TPPLAY', rechargeAmount: 132300, rechargeUsers: 318, withdrawAmount: 70500, withdrawUsers: 118, successCount: 552, failedCount: 22 },
  { date: '2026-04-19', platform: 'TPPLAY', rechargeAmount: 141400, rechargeUsers: 326, withdrawAmount: 74900, withdrawUsers: 120, successCount: 581, failedCount: 24 }
];

const platformSelect = document.getElementById('platformSelect');
const startDate = document.getElementById('startDate');
const endDate = document.getElementById('endDate');
const searchBtn = document.getElementById('searchBtn');
const resetBtn = document.getElementById('resetBtn');
const refreshBtn = document.getElementById('refreshBtn');
const tableBody = document.getElementById('tableBody');

let amountChart;
let countChart;

function formatNumber(num) {
  return Number(num).toLocaleString('en-US');
}

function getPlatforms() {
  return ['全部平台', ...new Set(demoData.map(item => item.platform))];
}

function initFilters() {
  platformSelect.innerHTML = getPlatforms()
    .map(item => `<option value="${item}">${item}</option>`)
    .join('');

  startDate.value = '2026-04-12';
  endDate.value = '2026-04-19';
}

function filterData() {
  const selectedPlatform = platformSelect.value;
  const start = startDate.value;
  const end = endDate.value;

  return demoData.filter(item => {
    const platformMatch = selectedPlatform === '全部平台' || item.platform === selectedPlatform;
    const startMatch = !start || item.date >= start;
    const endMatch = !end || item.date <= end;
    return platformMatch && startMatch && endMatch;
  });
}

function updateCards(data) {
  const totals = data.reduce((acc, item) => {
    acc.rechargeAmount += item.rechargeAmount;
    acc.rechargeUsers += item.rechargeUsers;
    acc.withdrawAmount += item.withdrawAmount;
    acc.withdrawUsers += item.withdrawUsers;
    acc.successCount += item.successCount;
    acc.failedCount += item.failedCount;
    return acc;
  }, {
    rechargeAmount: 0,
    rechargeUsers: 0,
    withdrawAmount: 0,
    withdrawUsers: 0,
    successCount: 0,
    failedCount: 0
  });

  document.getElementById('rechargeAmount').textContent = formatNumber(totals.rechargeAmount);
  document.getElementById('rechargeUsers').textContent = formatNumber(totals.rechargeUsers);
  document.getElementById('withdrawAmount').textContent = formatNumber(totals.withdrawAmount);
  document.getElementById('withdrawUsers').textContent = formatNumber(totals.withdrawUsers);
  document.getElementById('successCount').textContent = formatNumber(totals.successCount);
  document.getElementById('failedCount').textContent = formatNumber(totals.failedCount);
}

function updateTable(data) {
  if (!data.length) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px;">暂无数据</td></tr>`;
    return;
  }

  tableBody.innerHTML = data.map(item => `
    <tr>
      <td>${item.date}</td>
      <td>${item.platform}</td>
      <td>${formatNumber(item.rechargeAmount)}</td>
      <td>${formatNumber(item.rechargeUsers)}</td>
      <td>${formatNumber(item.withdrawAmount)}</td>
      <td>${formatNumber(item.withdrawUsers)}</td>
      <td>${formatNumber(item.successCount)}</td>
      <td>${formatNumber(item.failedCount)}</td>
    </tr>
  `).join('');
}

function groupByDate(data) {
  const map = {};
  data.forEach(item => {
    if (!map[item.date]) {
      map[item.date] = {
        rechargeAmount: 0,
        withdrawAmount: 0,
        successCount: 0,
        failedCount: 0
      };
    }

    map[item.date].rechargeAmount += item.rechargeAmount;
    map[item.date].withdrawAmount += item.withdrawAmount;
    map[item.date].successCount += item.successCount;
    map[item.date].failedCount += item.failedCount;
  });

  return map;
}

function updateCharts(data) {
  const grouped = groupByDate(data);
  const labels = Object.keys(grouped).sort();
  const rechargeAmounts = labels.map(date => grouped[date].rechargeAmount);
  const withdrawAmounts = labels.map(date => grouped[date].withdrawAmount);
  const successCounts = labels.map(date => grouped[date].successCount);
  const failedCounts = labels.map(date => grouped[date].failedCount);

  if (amountChart) amountChart.destroy();
  if (countChart) countChart.destroy();

  amountChart = new Chart(document.getElementById('amountChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '充值金额',
          data: rechargeAmounts,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.15)',
          tension: 0.35,
          fill: true
        },
        {
          label: '提款金额',
          data: withdrawAmounts,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.12)',
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top'
        }
      }
    }
  });

  countChart = new Chart(document.getElementById('countChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '成功笔数',
          data: successCounts,
          backgroundColor: '#2563eb'
        },
        {
          label: '失败笔数',
          data: failedCounts,
          backgroundColor: '#f97316'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top'
        }
      }
    }
  });
}

function render() {
  const data = filterData();
  updateCards(data);
  updateTable(data);
  updateCharts(data);
}

searchBtn.addEventListener('click', render);
refreshBtn.addEventListener('click', render);
resetBtn.addEventListener('click', () => {
  platformSelect.value = '全部平台';
  startDate.value = '2026-04-12';
  endDate.value = '2026-04-19';
  render();
});

initFilters();
render();
