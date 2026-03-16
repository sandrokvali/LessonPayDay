const DB_URL = 'https://paydate-for-lessons-default-rtdb.europe-west1.firebasedatabase.app/.json';

let data = { schedules: {}, exceptions: {} };
const FIXED_RATE = 8;
const PAY_SUBJECTS = ['English', 'Chemistry'];
let payInfoStore = {}; // Stores payment status per date
let showAllMonths = false;

function subjVar(subject) {
    if(!subject) return 'eng';
    const s = subject.toLowerCase();
    if(s.startsWith('chem')) return 'chem';
    return s.substring(0,3);
}

function isPaid(dateStr, subject) {
    return data.exceptions && data.exceptions[`PAID_${dateStr}_${subject}`] === 'paid';
}

function unmarkPaid(dateStr, subject) {
    const key = `PAID_${dateStr}_${subject}`;
    if(data.exceptions && data.exceptions[key]) {
        delete data.exceptions[key];
        // optimistic UI update
        renderCalendar();
        if($('#summaryModal').is(':visible')) openPaySummary();
        if($('#dayModal').is(':visible')) openDay(dateStr);
        // persist change
        pushData();
    }
}

$(document).ready(() => { fetchData(); });

function fetchData() {
    $('#syncStatus').show().text("Syncing...");
    $.get(DB_URL, (res) => {
        data = res || { schedules: {}, exceptions: {} };
        if(!data.schedules) data.schedules = {};
        if(!data.exceptions) data.exceptions = {};
        renderCalendar();
        $('#syncStatus').fadeOut();
    });
}

function pushData() {
    $('#syncStatus').show().text("Saving...");
    $.ajax({
        url: DB_URL, type: 'PUT',
        data: JSON.stringify(data),
        success: () => fetchData()
    });
}

function expandSchedules() {
    let list = [];
    Object.keys(data.schedules).forEach(sid => {
        const s = data.schedules[sid];
        let d = new Date(s.startDate);
        while(d.getFullYear() <= 2026) {
            const key = `${d.toDateString()}_${s.subject}`;
            if(data.exceptions[key] !== 'deleted') {
                list.push({ sid, subject: s.subject, date: new Date(d), key });
            }
            d.setDate(d.getDate() + 7);
        }
    });
    Object.keys(data.exceptions).forEach(key => {
        if(key.includes("SINGLE_") && data.exceptions[key] !== 'deleted') {
            const parts = key.split('_');
            list.push({ sid: 'one-off', subject: parts[2], date: new Date(parts[1]), key });
        }
    });
    return list.sort((a,b) => a.date - b.date);
}

function renderCalendar() {
    const container = $('#calendarContainer').empty();
    const all = expandSchedules();
    const now = new Date();

    // Reset counters and stores
    let counters = { English: 0, Chemistry: 0 };
    payInfoStore = {}; 

    // Chronological payment calculation
    all.forEach(occ => {
        if (PAY_SUBJECTS.includes(occ.subject)) {
            counters[occ.subject]++;
            if(counters[occ.subject] % FIXED_RATE === 0) {
                const dateKey = occ.date.toDateString();
                if(!payInfoStore[dateKey]) payInfoStore[dateKey] = [];
                if(!payInfoStore[dateKey].includes(occ.subject)) payInfoStore[dateKey].push(occ.subject);
            }
        }
    });

    // Add Georgian fixed monthly paydate on the 27th of every month
    for (let mi = 0; mi < 12; mi++) {
        const pd = new Date(now.getFullYear(), mi, 27);
        const pk = pd.toDateString();
        if(!payInfoStore[pk]) payInfoStore[pk] = [];
        if(!payInfoStore[pk].includes('Georgian')) payInfoStore[pk].push('Georgian');
    }

    const startMonth = showAllMonths ? 0 : now.getMonth();
    for (let i = startMonth; i < 12; i++) {
        let d = new Date(now.getFullYear(), i, 1);
        container.append(buildMonth(d, all));
    }
}

function toggleFullCalendar() {
    showAllMonths = !showAllMonths;
    const btn = document.getElementById('toggleCalendarBtn');
    if(btn) btn.textContent = showAllMonths ? 'Show Current Months' : 'Show Full Calendar';
    renderCalendar();
}

function markPaid(dateStr, subject) {
    const key = `PAID_${dateStr}_${subject}`;
    data.exceptions = data.exceptions || {};
    data.exceptions[key] = 'paid';
    // optimistic UI update
    renderCalendar();
    if($('#summaryModal').is(':visible')) openPaySummary();
    if($('#dayModal').is(':visible')) openDay(dateStr);
    // persist change
    pushData();
}

function buildMonth(date, all) {
    const y = date.getFullYear(), m = date.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const lastDate = new Date(y, m + 1, 0).getDate();
    let html = `<div class="month-wrap"><div class="month-label">${new Intl.DateTimeFormat('en-US', {month:'long', year:'numeric'}).format(date)}</div><div class="grid">`;
    ['SUN','MON','TUE','WED','THU','FRI','SAT'].forEach(wd => html += `<div class="wd">${wd}</div>`);

    for (let i = 0; i < firstDay; i++) html += `<div class="day"></div>`;

    for (let d = 1; d <= lastDate; d++) {
        const dObj = new Date(y, m, d);
        const dKey = dObj.toDateString();
        const paySubjects = payInfoStore[dKey] || [];
        const isPayDay = paySubjects.length > 0;
        const isToday = dKey === new Date().toDateString() ? 'today' : '';

        // If Georgian is a pay subject for this date, add georgian-pay for green styling
        const georgianClass = paySubjects.includes('Georgian') ? 'georgian-pay' : '';

        let cellHtml = `<div class="day ${isPayDay ? 'pay-day' : ''} ${georgianClass} ${isToday}" onclick="openDay('${dKey}')"><span class="day-num">${d}</span>`;
        all.filter(o => o.date.toDateString() === dKey).forEach(o => {
            const dueClass = paySubjects.includes(o.subject) ? 'due' : '';
            cellHtml += `<div class="lesson ${o.subject} ${dueClass}">${o.subject}${dueClass ? ' •' : ''}</div>`;
        });
        html += cellHtml + `</div>`;
    }
    return html + `</div></div>`;
}

function openDay(dateStr) {
    $('#dayTitle').text(dateStr);
    const alertBox = $('#payAlertBox').hide().empty();
    const list = $('#dayList').empty();
    const dayOcc = expandSchedules().filter(o => o.date.toDateString() === dateStr);

    // Show payment notification if day is highlighted
    if(payInfoStore[dateStr]) {
        // Show per-subject buttons: unpaid -> Mark Paid (green), paid -> Unpay (red). No extra "Paid" text.
        let parts = payInfoStore[dateStr].map(sub => {
            if(isPaid(dateStr, sub)) {
                return `<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;"><span>⚠️ ${sub}</span><div><button class=\"btn btn-danger\" style=\"padding:6px 10px; font-size:0.85rem;\" onclick=\"unmarkPaid('${dateStr}','${sub}')\">Unpay</button></div></div>`;
            }
            return `<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:6px;"><span>⚠️ ${sub}</span><div><button class=\"btn btn-success\" style=\"padding:6px 10px; font-size:0.85rem\" onclick=\"markPaid('${dateStr}','${sub}')\">Mark Paid</button></div></div>`;
        });
        alertBox.show().html(parts.join(''));
    }

    dayOcc.forEach(o => {
        const v = subjVar(o.subject);
        list.append(`
            <div style="border-bottom:1px solid #eee; padding:15px 0; display:flex; justify-content:space-between; align-items:center;">
                <div style=\"display:flex; align-items:center; gap:12px;\"><div style=\"width:6px; height:36px; background:var(--${v}); border-radius:3px;\"></div><b>${o.subject}</b></div>
                <div style="display:flex; gap:10px;">
                    <button class="btn btn-outline" style="padding:5px 10px; font-size:0.7rem;" onclick="deleteSingle('${o.key}')">Delete Today</button>
                    ${o.sid !== 'one-off' ? `<button class="btn btn-primary" style="padding:5px 10px; font-size:0.7rem; background:#ef4444;" onclick="deleteAllSchedule('${o.sid}')">Stop Schedule</button>` : ''}
                </div>
            </div>
        `);
    });
    openModal('dayModal');
}

function openPaySummary() {
    const list = $('#summaryList').empty();
    let found = false;
    Object.keys(payInfoStore).sort((a,b) => new Date(a) - new Date(b)).forEach(dateKey => {
        const subs = payInfoStore[dateKey];
        if(!subs || subs.length === 0) return;
        // filter out already-paid subjects so paid dates don't show in the list
        const unpaid = subs.filter(s => !isPaid(dateKey, s));
        if(unpaid.length === 0) return;
        found = true;
        unpaid.forEach(sub => {
            list.append(`
                <div class="forecast-item ${sub}" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <div><strong>${sub}</strong><div style="font-size:0.85rem; color:#64748b">${dateKey}</div></div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button class="btn btn-success" onclick="markPaid('${dateKey}','${sub}')">Mark Paid</button>
                    </div>
                </div>
            `);
        });
    });
    if(!found) list.append("<p style='text-align:center; color:#94a3b8;'>No payments scheduled.</p>");
    openModal('summaryModal');
}

function saveSchedule() {
    const id = "S_" + Date.now();
    data.schedules[id] = { subject: $('#subIn').val(), startDate: $('#startIn').val(), time: $('#timeIn').val() };
    pushData(); closeModal('addModal');
}

function addSingleLesson() {
    const sub = $('#singleSubIn').val();
    const key = `SINGLE_${new Date($('#dayTitle').text()).toDateString()}_${sub}`;
    data.exceptions[key] = 'added';
    pushData(); closeModal('dayModal');
}

function deleteSingle(key) {
    data.exceptions[key] = 'deleted';
    pushData(); closeModal('dayModal');
}

function deleteAllSchedule(sid) {
    if(confirm("Stop this schedule?")) {
        delete data.schedules[sid];
        pushData(); closeModal('dayModal');
    }
}

function openModal(id) { $(`#${id}`).css('display', 'flex'); }
function closeModal(id) { $(`#${id}`).hide(); }