const sb = supabase.createClient(CFG.url, CFG.key);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = d => d ? new Date(d).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '—';
// Checklists: [label, critical?]. Edit freely.
const CL = {
  forklift: [['Forks & heel',1],['Mast & lift chains',1],['Brakes',1],['Steering',1],['Overhead guard & load backrest',1],['Hydraulic hoses / leaks',0],['Tyres',0],['Horn, lights, reverse alarm',0],['Seatbelt',0],['Fire extinguisher',0],['Operator cert & inspection tag',0]],
  crane: [['Wire rope & hook latch',1],['Boom / structure',1],['Limit switches / anti-two-block',1],['Brakes & slew',1],['Hydraulics & outriggers',1],['Load chart & SWL plate',0],['Cabin, controls, emergency stop',0],['Alarms, lights, horn',0],['Fire extinguisher',0],['Certification & operator competency',0]]
};
const LABEL = {cleared:'Cleared', conditional:'Cleared with conditions', out_of_service:'Out of service', review:'In review', none:'Not inspected'};
const badge = k => `<span class="badge b-${k}">${LABEL[k] || k}</span>`;
let me = JSON.parse(localStorage.getItem('me') || 'null');

function toast(m, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' error' : ''); t.textContent = m; $('#toast').append(t); setTimeout(() => t.remove(), 3500); }
function showMe() { $('#me').innerHTML = me ? `<b>${esc(me.name)}</b><br><span class="muted">${esc(me.dept)} · change</span>` : 'Set your name &amp; department'; }
function askMe() {
  const name = prompt('Your name:', me?.name || ''); if (!name) return;
  const dept = prompt('Department — type HSE or Operations:', me?.dept || 'HSE');
  if (!['HSE', 'Operations'].includes(dept)) return toast('Department must be HSE or Operations', 1);
  me = {name, dept}; localStorage.setItem('me', JSON.stringify(me)); showMe();
}
function needMe() { if (!me) { askMe(); } return !!me; }

async function go(view, arg) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#body').innerHTML = '<p class="muted">Loading…</p>';
  try { await views[view](arg); } catch (e) { $('#body').innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
}
const q = async p => { const {data, error} = await p; if (error) throw error; return data; };
const status = ins => !ins ? 'none' : (ins.decision || 'review');

const views = {
  async matrix() {
    $('#title').textContent = 'Equipment Status';
    const [eq, ins] = await Promise.all([q(sb.from('equipment').select('*').order('tag')), q(sb.from('inspections').select('id,equipment_id,decision,created_at').order('created_at', {ascending: false}))]);
    const last = {}; ins.forEach(i => { if (!last[i.equipment_id]) last[i.equipment_id] = i; });
    $('#body').innerHTML = eq.length ? `<div class="tbl-wrap"><table><thead><tr><th>Tag</th><th>Type</th><th>Rig</th><th>Cert expiry</th><th>Status</th><th>Last inspection</th></tr></thead><tbody>` +
      eq.map(e => { const l = last[e.id]; const exp = e.cert_expiry && new Date(e.cert_expiry) < new Date();
        return `<tr><td><b>${esc(e.tag)}</b></td><td>${e.type}</td><td>${esc(e.rig)}</td><td${exp ? ' style="color:var(--danger);font-weight:700"' : ''}>${fmt(e.cert_expiry)}${exp ? ' (expired)' : ''}</td><td>${badge(status(l))}</td><td>${l ? `<button class="link" onclick="go('detail','${l.id}')">${fmt(l.created_at)}</button>` : '—'}</td></tr>`; }).join('') + '</tbody></table></div>'
      : '<p class="muted">No equipment yet. Add some in Equipment Register.</p>';
  },

  async register() {
    $('#title').textContent = 'Equipment Register';
    const eq = await q(sb.from('equipment').select('*').order('tag'));
    $('#body').innerHTML = `<div class="card"><h3 class="card-title">Add equipment</h3><div class="row">
      <div class="field"><label>Tag / ID</label><input id="e-tag" placeholder="e.g. FL-012"></div>
      <div class="field"><label>Type</label><select id="e-type"><option>forklift</option><option>crane</option></select></div>
      <div class="field"><label>Rig</label><input id="e-rig"></div></div>
      <div class="field" style="max-width:260px"><label>Certificate expiry</label><input id="e-exp" type="date"></div>
      <button class="btn btn-primary" id="e-add">Add equipment</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>Tag</th><th>Type</th><th>Rig</th><th>Cert expiry</th></tr></thead><tbody>${eq.map(e => `<tr><td>${esc(e.tag)}</td><td>${e.type}</td><td>${esc(e.rig)}</td><td>${fmt(e.cert_expiry)}</td></tr>`).join('')}</tbody></table></div>`;
    $('#e-add').onclick = async () => {
      const tag = $('#e-tag').value.trim(); if (!tag) return toast('Tag required', 1);
      try { await q(sb.from('equipment').insert({tag, type: $('#e-type').value, rig: $('#e-rig').value.trim(), cert_expiry: $('#e-exp').value || null})); toast('Equipment added'); go('register'); } catch (e) { toast(e.message, 1); }
    };
  },

  async new() {
    $('#title').textContent = 'New Inspection';
    const eq = await q(sb.from('equipment').select('*').order('tag'));
    if (!eq.length) { $('#body').innerHTML = '<p class="muted">Add equipment first in Equipment Register.</p>'; return; }
    $('#body').innerHTML = `<div class="field" style="max-width:360px"><label>Equipment</label><select id="n-eq">${eq.map(e => `<option value="${e.id}" data-t="${e.type}">${esc(e.tag)} (${e.type}${e.rig ? ', ' + esc(e.rig) : ''})</option>`).join('')}</select></div><div id="n-list"></div>`;
    const draw = () => {
      const t = $('#n-eq').selectedOptions[0].dataset.t;
      $('#n-list').innerHTML = `<div class="card">` + CL[t].map(([l, c], i) => `<div class="item" data-i="${i}"><div class="item-head"><span>${esc(l)}${c ? '<span class="crit">critical</span>' : ''}</span></div>
        <div class="seg">${['pass', 'fail', 'na'].map((v, k) => `<label><input type="radio" name="r${i}" value="${v}"${k ? '' : ' checked'}>${v === 'na' ? 'N/A' : v[0].toUpperCase() + v.slice(1)}</label>`).join('')}</div>
        <input class="cm" placeholder="Initial comment"><div style="margin-top:6px"><input class="ph" type="file" accept="image/*" capture="environment" multiple></div></div>`).join('') +
        `</div><button class="btn btn-primary" id="n-go">Submit for joint review</button>`;
      $('#n-go').onclick = submit;
    };
    $('#n-eq').onchange = draw; draw();

    async function shrink(f) { const b = await createImageBitmap(f), k = Math.min(1, 1280 / Math.max(b.width, b.height)); const c = document.createElement('canvas'); c.width = b.width * k; c.height = b.height * k; c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); return new Promise(res => c.toBlob(res, 'image/jpeg', .7)); }
    async function submit() {
      if (!needMe()) return;
      const sel = $('#n-eq').selectedOptions[0], list = CL[sel.dataset.t], btn = $('#n-go'), items = [];
      btn.disabled = true; btn.textContent = 'Uploading photos…';
      try {
        const nodes = [...document.querySelectorAll('#n-list .item')];
        for (const [i, n] of nodes.entries()) {
          const result = n.querySelector('input[type=radio]:checked').value, comment = n.querySelector('.cm').value.trim(), files = [...n.querySelector('.ph').files];
          if (result === 'fail' && (!comment || !files.length)) throw new Error(`"${list[i][0]}" is marked Fail — add a comment and at least one photo.`);
          const photos = [];
          for (const f of files) { const path = `${sel.value}/${Date.now()}-${i}-${photos.length}.jpg`; const {error} = await sb.storage.from('inspection-photos').upload(path, await shrink(f), {contentType: 'image/jpeg'}); if (error) throw error; photos.push(sb.storage.from('inspection-photos').getPublicUrl(path).data.publicUrl); }
          items.push({label: list[i][0], critical: !!list[i][1], result, comment, photos});
        }
        const row = await q(sb.from('inspections').insert({equipment_id: sel.value, inspector: me.name, items}).select().single());
        toast('Submitted for review'); go('detail', row.id);
      } catch (e) { toast(e.message, 1); btn.disabled = false; btn.textContent = 'Submit for joint review'; }
    }
  },

  async queue() {
    $('#title').textContent = 'Review Queue';
    const [ins, eq, rev] = await Promise.all([q(sb.from('inspections').select('*').is('decision', null).order('created_at')), q(sb.from('equipment').select('id,tag,type')), q(sb.from('reviews').select('inspection_id,dept'))]);
    const E = Object.fromEntries(eq.map(e => [e.id, e]));
    $('#body').innerHTML = ins.length ? `<div class="tbl-wrap"><table><thead><tr><th>Equipment</th><th>Inspector</th><th>Date</th><th>Fails</th><th>HSE</th><th>Operations</th></tr></thead><tbody>` + ins.map(i => {
      const has = d => rev.some(r => r.inspection_id === i.id && r.dept === d), f = i.items.filter(x => x.result === 'fail').length;
      return `<tr><td><button class="link" onclick="go('detail','${i.id}')">${esc(E[i.equipment_id]?.tag)}</button></td><td>${esc(i.inspector)}</td><td>${fmt(i.created_at)}</td><td>${f ? `<span class="badge b-fail">${f}</span>` : '0'}</td><td>${has('HSE') ? '✓' : '⏳'}</td><td>${has('Operations') ? '✓' : '⏳'}</td></tr>`;
    }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing waiting for review.</p>';
  },

  async detail(id) {
    const ins = await q(sb.from('inspections').select('*, equipment(*)').eq('id', id).single());
    const revs = await q(sb.from('reviews').select('*').eq('inspection_id', id).order('created_at'));
    $('#title').textContent = `${ins.equipment.tag} — inspection ${fmt(ins.created_at)}`;
    const fails = ins.items.filter(i => i.result === 'fail');
    const has = d => revs.some(r => r.dept === d);
    let p = null, why = 'Waiting for both HSE and Operations to review.';
    if (has('HSE') && has('Operations')) {
      if (revs.some(r => r.verdict === 'recheck')) why = 'A reviewer asked for a re-check — re-inspect and submit a new inspection.';
      else if (revs.some(r => r.verdict === 'disagree')) { p = 'escalate'; why = 'Departments disagree — final approver decides.'; }
      else { p = !fails.length ? 'cleared' : fails.some(i => i.critical) ? 'out_of_service' : 'conditional'; why = 'Both departments agree.'; }
    }
    $('#body').innerHTML = `<p>${badge(status(ins))} <span class="muted small">Inspected by ${esc(ins.inspector)} · ${esc(ins.equipment.type)} · ${esc(ins.equipment.rig)}</span></p>
      ${ins.decision ? `<div class="card"><h3 class="card-title">Final decision</h3>${badge(ins.decision)}<p>${esc(ins.decision_note)}</p><p class="muted small">${esc(ins.decided_by)} · ${fmt(ins.decided_at)}</p></div>` : ''}
      <div class="card"><h3 class="card-title">HSE findings</h3>${ins.items.map(i => `<div class="item"><div class="item-head"><span>${esc(i.label)}${i.critical ? '<span class="crit">critical</span>' : ''}</span><span class="badge ${i.result === 'fail' ? 'b-fail' : i.result === 'pass' ? 'b-cleared' : ''}">${i.result.toUpperCase()}</span></div>${i.comment ? `<div class="muted">${esc(i.comment)}</div>` : ''}<div class="thumbs">${i.photos.map(u => `<a href="${u}" target="_blank"><img src="${u}" loading="lazy"></a>`).join('')}</div></div>`).join('')}</div>
      <div class="card"><h3 class="card-title">Department reviews</h3>${revs.map(r => `<div class="rev ${r.verdict}"><b>${esc(r.dept)}</b> · ${esc(r.reviewer)} · <b>${r.verdict}</b> <span class="muted small">${fmt(r.created_at)}</span><div>${esc(r.comment)}</div></div>`).join('') || '<p class="muted">No reviews yet.</p>'}
      ${ins.decision ? '' : `<div class="field"><label>Your review (${me ? esc(me.name) + ', ' + me.dept : 'set your name first'})</label><select id="v-verdict"><option value="agree">Agree with HSE findings</option><option value="disagree">Disagree</option><option value="recheck">Needs re-check</option></select></div><div class="field"><textarea id="v-cm" rows="2" placeholder="Comment"></textarea></div><button class="btn btn-primary" id="v-go">Submit review</button>`}</div>
      ${ins.decision ? '' : `<div class="card"><h3 class="card-title">Final decision</h3><p>${esc(why)}${p && p !== 'escalate' ? ` Suggested: ${badge(p)}` : ''}</p>${p ? `<div class="field"><select id="d-dec"><option value="cleared">Cleared</option><option value="conditional">Cleared with conditions</option><option value="out_of_service">Out of service</option></select></div><div class="field"><textarea id="d-note" rows="2" placeholder="Conditions / reason / due date"></textarea></div><button class="btn btn-primary" id="d-go">Record final decision</button>` : ''}</div>`}`;
    if (p && p !== 'escalate' && $('#d-dec')) $('#d-dec').value = p;
    $('#v-go') && ($('#v-go').onclick = async () => {
      if (!needMe()) return;
      try { await q(sb.from('reviews').insert({inspection_id: id, dept: me.dept, reviewer: me.name, verdict: $('#v-verdict').value, comment: $('#v-cm').value.trim()})); toast('Review saved'); go('detail', id); } catch (e) { toast(e.message, 1); }
    });
    $('#d-go') && ($('#d-go').onclick = async () => {
      if (!needMe()) return;
      try { await q(sb.from('inspections').update({decision: $('#d-dec').value, decision_note: $('#d-note').value.trim(), decided_by: `${me.name} (${me.dept})`, decided_at: new Date().toISOString()}).eq('id', id)); toast('Decision recorded'); go('detail', id); } catch (e) { toast(e.message, 1); }
    });
  }
};

document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => go(b.dataset.view));
$('#me').onclick = askMe; showMe();
sb.from('equipment').select('id', {head: true, count: 'exact'}).then(({error}) => { const c = $('#conn'); c.textContent = error ? 'Not connected' : '● Connected'; c.className = 'conn ' + (error ? 'err' : 'ok'); });
go('matrix');
