import { parseArchiveMigrationReview } from "./archive-migration-review.js";

function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

export function renderArchiveMigrationReviewPage(reviewValue: unknown): string {
  const review = parseArchiveMigrationReview(reviewValue);
  const payload = scriptSafeJson(review);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Feather-Light Migration Review</title>
<style>
:root{color-scheme:dark;--bg:#111418;--panel:#1b2027;--line:#343c47;--text:#edf1f5;--muted:#aab4c0;--accent:#79b8ff;--manual:#ffbd69}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:28px}h1{margin:0 0 6px}header{position:sticky;top:0;background:var(--bg);padding:0 0 18px;z-index:2}.toolbar{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-top:16px}label{display:grid;gap:5px;color:var(--muted)}input,select,textarea,button{font:inherit;color:var(--text);background:#0d1014;border:1px solid var(--line);border-radius:6px;padding:8px}button{cursor:pointer;background:#25364a;border-color:#41658d}button:hover{background:#304b69}.count{margin-left:auto;color:var(--muted)}section{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:16px;margin:12px 0}.path{font-weight:650;overflow-wrap:anywhere}.meta{display:flex;gap:12px;color:var(--muted);margin:5px 0 12px}.manual{color:var(--manual)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0d1014;padding:10px;border-radius:6px}.reason{color:var(--muted)}.decision{display:grid;grid-template-columns:180px 1fr;gap:10px;margin-top:12px}.replacement{display:none;min-height:70px}.decision[data-replace="true"] .replacement{display:block}@media(max-width:650px){main{padding:16px}.decision{grid-template-columns:1fr}.count{margin-left:0}}
</style>
</head>
<body><main>
<header><h1>Feather-Light Migration Review</h1><div>Offline review · root <span id="root"></span> · no note bodies included</div>
<div class="toolbar"><label>Reviewer<input id="reviewer" autocomplete="name" placeholder="Your name"></label><label>Show<select id="filter"><option value="all">All</option><option value="pending">Pending</option><option value="manual">Manual</option><option value="completed">Completed</option></select></label><button id="approve-review">Approve visible review proposals</button><button id="download">Download review JSON</button><span class="count" id="count"></span></div></header>
<div id="entries"></div>
</main>
<script id="review-data" type="application/json">${payload}</script>
<script>
const review=JSON.parse(document.getElementById('review-data').textContent);const entries=document.getElementById('entries');
document.getElementById('root').textContent=review.rootId;
function valueText(value){return JSON.stringify(value,null,2)??'null'}
function render(){const filter=document.getElementById('filter').value;entries.replaceChildren();let shown=0;for(const [index,d] of review.decisions.entries()){const completed=d.action!=='pending';if(filter==='pending'&&completed||filter==='manual'&&d.proposal?.level!=='manual'||filter==='completed'&&!completed)continue;shown++;const card=document.createElement('section');card.dataset.index=String(index);const path=document.createElement('div');path.className='path';path.textContent=d.relativePath;const meta=document.createElement('div');meta.className='meta';meta.innerHTML='<span></span><span></span>';meta.children[0].textContent=d.field;meta.children[1].textContent=d.proposal?.level??'';if(d.proposal?.level==='manual')meta.children[1].className='manual';const proposed=document.createElement('pre');proposed.textContent=valueText(d.proposal?.value);const reason=document.createElement('div');reason.className='reason';reason.textContent=d.proposal?.reason??'';const controls=document.createElement('div');controls.className='decision';const select=document.createElement('select');for(const action of ['pending','approve','replace','reject']){const option=document.createElement('option');option.value=action;option.textContent=action;option.selected=d.action===action;select.append(option)}const replacement=document.createElement('textarea');replacement.className='replacement';replacement.placeholder='Replacement value as JSON';replacement.value=d.value===undefined?'':valueText(d.value);controls.dataset.replace=String(d.action==='replace');select.onchange=()=>{d.action=select.value;if(d.action!=='replace')delete d.value;controls.dataset.replace=String(d.action==='replace');updateCount()};replacement.oninput=()=>{d._replacement=replacement.value};controls.append(select,replacement);card.append(path,meta,proposed,reason,controls);entries.append(card)}document.getElementById('count').textContent=shown+' shown · '+review.decisions.filter(d=>d.action==='pending').length+' pending'}
function updateCount(){document.getElementById('count').textContent=document.querySelectorAll('section').length+' shown · '+review.decisions.filter(d=>d.action==='pending').length+' pending'}
document.getElementById('filter').onchange=render;document.getElementById('approve-review').onclick=()=>{for(const card of document.querySelectorAll('section')){const d=review.decisions[Number(card.dataset.index)];if(d.action==='pending'&&d.proposal?.level==='review')d.action='approve'}render()};
document.getElementById('download').onclick=()=>{const reviewer=document.getElementById('reviewer').value.trim();const decidedAt=new Date().toISOString();for(const d of review.decisions){if(d.action==='pending'){delete d.reviewer;delete d.decidedAt;delete d.value}else{if(!reviewer){alert('Enter a reviewer name before downloading.');return}d.reviewer=reviewer;d.decidedAt=decidedAt;if(d.action==='replace'){try{d.value=JSON.parse(d._replacement??valueText(d.value))}catch{alert('A replacement value is not valid JSON.');return}}else delete d.value}delete d._replacement}const blob=new Blob([JSON.stringify(review,null,2)+'\\n'],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='story-archive-migration-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)};render();
</script></body></html>\n`;
}
