const DB_URL = 'https://paydate-for-lessons-default-rtdb.europe-west1.firebasedatabase.app/.json';

let data = { schedules: {}, exceptions: {} };
const FIXED_RATE = 8;
const PAY_SUBJECTS = ['English', 'Chemistry'];
let payInfoStore = {}; // Stores payment status per date
let showAllMonths = false;
let editingScheduleId = null;
let editingScheduleDay = '';

function toISODateLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function sameCalendarDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function isWeeklyOccurrence(schedule, occDate) {
    const start = new Date(schedule.startDate);
    start.setHours(0, 0, 0, 0);
    const occ = new Date(occDate);
    occ.setHours(0, 0, 0, 0);
    if(occ < start) return false;
    const diffDays = Math.round((occ - start) / (24 * 60 * 60 * 1000));
    return diffDays % 7 === 0;
}

function normalizeData() {
    let changed = false;
    if(!data.schedules) data.schedules = {};
    if(!data.exceptions) data.exceptions = {};

    // Migrate old "stop schedule from this day onward" global deletes
    // into schedule endDate + remove those global keys.
    Object.keys(data.schedules).forEach(sid => {
        const s = data.schedules[sid];
        if(!s || s.endDate) return;
        let d = new Date(s.startDate);
        let firstDeleted = null;
        const occ = [];
        while(d.getFullYear() <= 2026) {
            const dt = new Date(d);
            occ.push(dt);
            const legacyKey = `${dt.toDateString()}_${s.subject}`;
            if(!firstDeleted && data.exceptions[legacyKey] === 'deleted') {
                firstDeleted = new Date(dt);
            }
            d.setDate(d.getDate() + 7);
        }
        if(!firstDeleted) return;

        const startIdx = occ.findIndex(x => sameCalendarDay(x, firstDeleted));
        if(startIdx < 0) return;
        let contiguousToEnd = true;
        for(let i = startIdx; i < occ.length; i++) {
            const k = `${occ[i].toDateString()}_${s.subject}`;
            if(data.exceptions[k] !== 'deleted') {
                contiguousToEnd = false;
                break;
            }
        }
        if(!contiguousToEnd) return;

        const endDate = new Date(firstDeleted);
        endDate.setDate(endDate.getDate() - 1);
        s.endDate = toISODateLocal(endDate);
        changed = true;

        for(let i = startIdx; i < occ.length; i++) {
            const k = `${occ[i].toDateString()}_${s.subject}`;
            if(data.exceptions[k] === 'deleted') {
                delete data.exceptions[k];
                changed = true;
            }
        }
    });

    // Migrate remaining legacy single-day global deletes to schedule-specific keys.
    Object.keys(data.exceptions).forEach(key => {
        if(data.exceptions[key] !== 'deleted') return;
        if(key.startsWith('SINGLE_') || key.startsWith('SCHED_')) return;
        const sep = key.indexOf('_');
        if(sep < 0) return;
        const datePart = key.substring(0, sep);
        const subject = key.substring(sep + 1);
        const occDate = new Date(datePart);
        if(Number.isNaN(occDate.getTime())) return;

        const matches = Object.keys(data.schedules).filter(sid => {
            const s = data.schedules[sid];
            if(!s || s.subject !== subject) return false;
            const end = s.endDate ? new Date(s.endDate) : null;
            if(end && occDate > end) return false;
            return isWeeklyOccurrence(s, occDate);
        });

        if(matches.length === 0) return;

        matches.sort((a, b) => {
            const sa = data.schedules[a];
            const sb = data.schedules[b];
            const da = new Date(sa.startDate).getTime();
            const db = new Date(sb.startDate).getTime();
            if(da !== db) return da - db;
            return String(a).localeCompare(String(b));
        });

        const chosenSid = matches[0];
        data.exceptions[`SCHED_${chosenSid}_${occDate.toDateString()}`] = 'deleted';
        delete data.exceptions[key];
        changed = true;
    });

    return changed;
}

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
    $.get(DB_URL, (body) => {
        data = body || { schedules: {}, exceptions: {} };
        if(!data.schedules) data.schedules = {};
        if(!data.exceptions) data.exceptions = {};
        const migrated = normalizeData();
        if(migrated) {
            pushData();
            return;
        }
        renderCalendar();
        $('#syncStatus').fadeOut();
    }).fail(() => $('#syncStatus').show().text("Sync failed"));
}

function pushData() {
    $('#syncStatus').show().text("Saving...");
    $.ajax({
        url: DB_URL, type: 'PUT',
        data: JSON.stringify(data),
        success: () => fetchData()
    }).fail(() => $('#syncStatus').show().text("Save failed"));
}

function expandSchedules() {
    let list = [];
    Object.keys(data.schedules).forEach(sid => {
        const s = data.schedules[sid];
        let d = new Date(s.startDate);
        const end = s.endDate ? new Date(s.endDate) : null;
        const timeStr = s.time || '';
        const [hhRaw, mmRaw] = timeStr.split(':');
        const hh = Number(hhRaw);
        const mm = Number(mmRaw);
        const timeMinutes = Number.isFinite(hh) && Number.isFinite(mm) ? (hh * 60 + mm) : Number.MAX_SAFE_INTEGER;
        while(d.getFullYear() <= 2026) {
            if(end && d > end) break;
            const dateStr = d.toDateString();
            const key = `SCHED_${sid}_${dateStr}`;
            const legacyKey = `${dateStr}_${s.subject}`;
            if(data.exceptions[key] !== 'deleted' && data.exceptions[legacyKey] !== 'deleted') {
                list.push({ sid, subject: s.subject, date: new Date(d), key, time: timeStr, timeMinutes });
            }
            d.setDate(d.getDate() + 7);
        }
    });
    Object.keys(data.exceptions).forEach(key => {
        if(key.includes("SINGLE_") && data.exceptions[key] !== 'deleted') {
            const parts = key.split('_');
            list.push({ sid: 'one-off', subject: parts[2], date: new Date(parts[1]), key, time: '', timeMinutes: Number.MAX_SAFE_INTEGER });
        }
    });
    return list.sort((a, b) => {
        const dateDiff = a.date - b.date;
        if(dateDiff !== 0) return dateDiff;
        const timeDiff = a.timeMinutes - b.timeMinutes;
        if(timeDiff !== 0) return timeDiff;
        return String(a.subject).localeCompare(String(b.subject));
    });
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
    const mondayFirstOffset = (firstDay + 6) % 7;
    const lastDate = new Date(y, m + 1, 0).getDate();
    let html = `<div class="month-wrap"><div class="month-label">${new Intl.DateTimeFormat('en-US', {month:'long', year:'numeric'}).format(date)}</div><div class="grid">`;
    ['MON','TUE','WED','THU','FRI','SAT','SUN'].forEach(wd => html += `<div class="wd">${wd}</div>`);

    for (let i = 0; i < mondayFirstOffset; i++) html += `<div class="day"></div>`;

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
        const timeText = o.time ? `<div style="font-size:0.8rem; color:#64748b;">${o.time}</div>` : '';
        list.append(`
            <div style="border-bottom:1px solid #eee; padding:15px 0; display:flex; justify-content:space-between; align-items:center;">
                <div style=\"display:flex; align-items:center; gap:12px;\"><div style=\"width:6px; height:36px; background:var(--${v}); border-radius:3px;\"></div><div><b>${o.subject}</b>${timeText}</div></div>
                <div style="display:flex; gap:10px;">
                    <button class="btn btn-outline" style="padding:5px 10px; font-size:0.7rem;" onclick="deleteSingle('${o.key}')">Delete Today</button>
                    ${o.sid !== 'one-off' ? `<button class="btn btn-outline" style="padding:5px 10px; font-size:0.7rem;" onclick="openEditTimeModal('${o.sid}','${dateStr}')">Edit Time</button>` : ''}
                    ${o.sid !== 'one-off' ? `<button class="btn btn-primary" style="padding:5px 10px; font-size:0.7rem; background:#ef4444;" onclick="deleteAllSchedule('${o.sid}','${dateStr}')">Stop Schedule</button>` : ''}
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

function deleteAllSchedule(sid, fromDateStr) {
    const s = data.schedules[sid];
    if(!s) return;

    if(!confirm("Stop this schedule from selected day onward?")) return;
    const endDate = new Date(fromDateStr);
    endDate.setDate(endDate.getDate() - 1);
    s.endDate = toISODateLocal(endDate);

    pushData();
    closeModal('dayModal');
}

function deleteSingle(key) {
    data.exceptions[key] = 'deleted';
    if(key.startsWith('SINGLE_')) {
        pushData();
        closeModal('dayModal');
        return;
    }

    // Legacy fallback (for older keys) - pin to a specific schedule when possible.
    if(!key.startsWith('SCHED_')) {
        const sep = key.indexOf('_');
        if(sep > 0) {
            const datePart = key.substring(0, sep);
            const subject = key.substring(sep + 1);
            const occDate = new Date(datePart);
            if(!Number.isNaN(occDate.getTime())) {
                const matches = Object.keys(data.schedules).filter(sid => {
                    const s = data.schedules[sid];
                    if(!s || s.subject !== subject) return false;
                    const end = s.endDate ? new Date(s.endDate) : null;
                    if(end && occDate > end) return false;
                    return isWeeklyOccurrence(s, occDate);
                });
                if(matches.length > 0) {
                    matches.sort((a, b) => {
                        const sa = data.schedules[a];
                        const sb = data.schedules[b];
                        const da = new Date(sa.startDate).getTime();
                        const db = new Date(sb.startDate).getTime();
                        if(da !== db) return da - db;
                        return String(a).localeCompare(String(b));
                    });
                    const chosenSid = matches[0];
                    data.exceptions[`SCHED_${chosenSid}_${occDate.toDateString()}`] = 'deleted';
                    delete data.exceptions[key];
                }
            }
        }
    }
    pushData();
    closeModal('dayModal');
}

function openEditTimeModal(sid, dateStr) {
    const s = data.schedules[sid];
    if(!s) return;
    editingScheduleId = sid;
    editingScheduleDay = dateStr || '';
    $('#editTimeSubject').text(s.subject || 'Lesson');
    $('#editTimeDate').text(editingScheduleDay || '');
    $('#editTimeIn').val(s.time || '10:00');
    openModal('editTimeModal');
}

function saveScheduleTime() {
    if(!editingScheduleId || !data.schedules[editingScheduleId]) return;
    const newTime = ($('#editTimeIn').val() || '').trim();
    if(!/^\d{2}:\d{2}$/.test(newTime)) {
        alert('Please choose a valid time.');
        return;
    }
    data.schedules[editingScheduleId].time = newTime;
    renderCalendar();
    if(editingScheduleDay) openDay(editingScheduleDay);
    closeModal('editTimeModal');
    pushData();
}

function openModal(id) { $(`#${id}`).css('display', 'flex'); }
function closeModal(id) { $(`#${id}`).hide(); }
