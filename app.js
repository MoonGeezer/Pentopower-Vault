const state={documents:[],filter:'all',query:'',executiveLoaded:false,executiveLoading:false,lawsLoaded:false};
const $=s=>document.querySelector(s);
const grid=$('#document-grid'),modal=$('#document-modal');
const EO_API='https://www.federalregister.gov/api/v1/documents.json?conditions%5Bpresident%5D=donald-trump&conditions%5Bpresidential_document_type%5D=executive_order&per_page=1000&order=newest';

function fmtDate(d){
  if(!d) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric'}).format(new Date(d+'T12:00:00'));
}
function searchable(d){return [d.id,d.title,d.type,d.agency,d.status,d.summary,d.collection,...(d.entities||[]),...(d.assertions||[])].join(' ').toLowerCase()}
function filtered(){return state.documents.filter(d=>(state.filter==='all'||d.type===state.filter)&&(!state.query||searchable(d).includes(state.query.toLowerCase())))}
function updateStats(){
  $('#doc-count').textContent=state.documents.length;
  $('#assertion-count').textContent=state.documents.reduce((n,d)=>n+(d.assertions||[]).length,0);
  $('#entity-count').textContent=new Set(state.documents.flatMap(d=>d.entities||[])).size;
}
function render(){
  updateLawsShelf();
  const docs=filtered();
  grid.innerHTML=docs.map(d=>`<article class="doc-card"><div class="doc-top"><span class="doc-type">${d.type}</span><span class="vault-id">${d.id}</span></div><h3>${d.title}</h3><p>${d.summary}</p><div class="chips">${(d.entities||[]).slice(0,3).map(e=>`<span class="chip">${e}</span>`).join('')}</div><div class="doc-meta"><span>${fmtDate(d.date)}</span><span>${d.agency}</span></div><button class="open-record" data-id="${d.id}">Open record</button></article>`).join('');
  $('#result-count').textContent=`${docs.length} record${docs.length===1?'':'s'}`;
  $('#active-query').textContent=state.executiveLoading?'Loading the complete Trump executive-order archive…':(state.query?`for “${state.query}”`:'');
  $('#empty-state').hidden=docs.length>0 || state.executiveLoading;
  renderTimeline(docs);
}
function renderTimeline(docs){$('#timeline-list').innerHTML=[...docs].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,100).map(d=>`<article class="timeline-item"><span class="timeline-date">${fmtDate(d.date)}</span><h3>${d.title}</h3><p>${d.type} · ${d.agency}</p></article>`).join('')}
function openRecord(id){
  const d=state.documents.find(x=>x.id===id);
  const pdfLink=d.pdf?`<a class="source-link secondary-source" href="${d.pdf}" target="_blank" rel="noopener">Open official PDF</a>`:'';
  $('#modal-content').innerHTML=`<div class="modal-inner"><p class="modal-label">${d.type} · ${d.id}</p><h2>${d.title}</h2><p>${d.summary}</p><div class="record-grid"><div class="record-box"><strong>Date</strong>${fmtDate(d.date)}</div><div class="record-box"><strong>Issuing body</strong>${d.agency}</div><div class="record-box"><strong>Evidence status</strong>${d.status}</div><div class="record-box"><strong>Collection</strong>${d.collection}</div></div><h3>What the record establishes or asserts</h3><ul class="assertions">${(d.assertions||[]).map(a=>`<li>${a}</li>`).join('')}</ul><h3>Indexed entities</h3><div class="chips">${(d.entities||[]).map(e=>`<span class="chip">${e}</span>`).join('')}</div><div class="source-actions"><a class="source-link" href="${d.source}" target="_blank" rel="noopener">Open primary source</a>${pdfLink}</div></div>`;
  modal.showModal();
}

function lawRecord(congress,number,term){
  const pl=`${congress}-${number}`;
  const pkg=`PLAW-${congress}publ${number}`;
  const url=`https://www.govinfo.gov/content/pkg/${pkg}/pdf/${pkg}.pdf`;
  return {
    id:`PL-${pl}`,
    title:`Public Law ${pl}`,
    type:'Law',
    date:'',
    agency:'United States Congress',
    status:'Enacted public law · authenticated GovInfo record',
    summary:`Public Law ${pl}, enacted during Donald J. Trump’s ${term==='First Term'?'first':'second'} presidential term. Open the authenticated Statutes at Large slip-law PDF for the complete official title and text.`,
    collection:`Trump Laws · ${term}`,
    entities:['Donald J. Trump','United States Congress','Government Publishing Office'],
    assertions:[`This record represents Public Law ${pl}.`,`The linked PDF is the authenticated public-law edition published by the U.S. Government Publishing Office.`],
    source:url,
    pdf:url
  };
}
function loadTrumpLaws(){
  if(state.lawsLoaded) return;
  const laws=[];
  for(let n=2;n<=442;n++) laws.push(lawRecord(115,n,'First Term'));
  for(let n=1;n<=344;n++) laws.push(lawRecord(116,n,'First Term'));
  for(let n=1;n<=100;n++) laws.push(lawRecord(119,n,'Second Term'));
  const existing=new Set(state.documents.map(d=>d.id));
  state.documents=[...laws.filter(d=>!existing.has(d.id)),...state.documents];
  state.lawsLoaded=true;
  updateStats();
}
function updateLawsShelf(){
  const shelf=$('#laws-shelf');
  if(shelf) shelf.hidden=state.filter!=='Law';
}

function normalizeEO(r){
  const eo=r.executive_order_number||r.document_number||'UNNUMBERED';
  const signed=r.signing_date||r.publication_date;
  return {
    id:`EO-${eo}`,
    title:r.title||`Executive Order ${eo}`,
    type:'Executive Order',
    date:signed,
    agency:'Executive Office of the President',
    status:'Official Federal Register record',
    summary:r.abstract||`Executive Order ${eo}, signed by President Donald J. Trump and published in the Federal Register.`,
    collection:signed && signed<'2021-01-21'?'Trump Executive Orders · First Term':'Trump Executive Orders · Second Term',
    entities:['Donald J. Trump','Executive Office of the President','Federal Register'],
    assertions:[`This is the official Federal Register record for Executive Order ${eo}.`,`Signed ${fmtDate(signed)}.`],
    source:r.html_url||r.raw_text_url||r.pdf_url,
    pdf:r.pdf_url||''
  };
}
async function loadExecutiveOrders(){
  if(state.executiveLoaded||state.executiveLoading) return;
  state.executiveLoading=true; render();
  try{
    const cached=localStorage.getItem('vault-trump-executive-orders-v1');
    let results=null;
    if(cached){
      const parsed=JSON.parse(cached);
      if(Date.now()-parsed.savedAt<86400000) results=parsed.results;
    }
    if(!results){
      const response=await fetch(EO_API,{headers:{Accept:'application/json'}});
      if(!response.ok) throw new Error(`Federal Register returned ${response.status}`);
      const payload=await response.json();
      results=payload.results||[];
      localStorage.setItem('vault-trump-executive-orders-v1',JSON.stringify({savedAt:Date.now(),results}));
    }
    const existing=new Set(state.documents.map(d=>d.id));
    const orders=results.map(normalizeEO).filter(d=>!existing.has(d.id));
    state.documents=[...orders,...state.documents];
    state.executiveLoaded=true;
    updateStats();
  }catch(err){
    console.error(err);
    $('#active-query').textContent='The Federal Register archive could not be loaded. Refresh to try again.';
  }finally{
    state.executiveLoading=false;
    render();
  }
}

fetch('data/documents.json').then(r=>r.json()).then(async data=>{
  state.documents=data;
  updateStats();
  render();
  await loadExecutiveOrders();
}).catch(()=>{grid.innerHTML='<p>Could not load the document index. Run this site through a local or hosted web server.</p>'});

$('#global-search').addEventListener('input',e=>{state.query=e.target.value.trim();render()});
$('#clear-search').addEventListener('click',()=>{$('#global-search').value='';state.query='';render()});
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',async()=>{
  document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  state.filter=b.dataset.filter;
  if(state.filter==='Executive Order') await loadExecutiveOrders();
  if(state.filter==='Law') loadTrumpLaws();
  render();
}));
grid.addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)openRecord(b.dataset.id)});
$('.modal-close').addEventListener('click',()=>modal.close());
modal.addEventListener('click',e=>{if(e.target===modal)modal.close()});
$('.menu-button').addEventListener('click',e=>{const n=$('#primary-nav'),open=n.classList.toggle('open');e.target.setAttribute('aria-expanded',open)});

document.querySelectorAll('[data-collection-query]').forEach((card)=>{
  card.addEventListener('click',()=>{
    const query=card.dataset.collectionQuery||'';
    const search=document.getElementById('global-search');
    if(search){search.value=query;search.dispatchEvent(new Event('input',{bubbles:true}))}
    document.getElementById('documents')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
});


document.querySelectorAll('[data-law-term]').forEach(card=>card.addEventListener('click',()=>{
  loadTrumpLaws();
  state.filter='Law';
  state.query=card.dataset.lawTerm||'';
  const search=$('#global-search');
  if(search) search.value=state.query;
  document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter==='Law'));
  render();
  document.querySelector('.results-summary')?.scrollIntoView({behavior:'smooth',block:'start'});
}));

// Judicial Vault navigation and case jackets
const judicialState={administration:'Trump I',circuit:'all'};
const districtMap={
  'Supreme Court':'United States Supreme Court',
  'D.C. Circuit':'D.C. Circuit Court of Appeals · U.S. District Court for the District of Columbia',
  '1st Circuit':'Maine · Massachusetts · New Hampshire · Puerto Rico · Rhode Island',
  '2nd Circuit':'Connecticut · New York · Vermont',
  '3rd Circuit':'Delaware · New Jersey · Pennsylvania · U.S. Virgin Islands',
  '4th Circuit':'Maryland · North Carolina · South Carolina · Virginia · West Virginia',
  '5th Circuit':'Louisiana · Mississippi · Texas',
  '6th Circuit':'Kentucky · Michigan · Ohio · Tennessee',
  '7th Circuit':'Illinois · Indiana · Wisconsin',
  '8th Circuit':'Arkansas · Iowa · Minnesota · Missouri · Nebraska · North Dakota · South Dakota',
  '9th Circuit':'Alaska · Arizona · California · Hawaii · Idaho · Montana · Nevada · Oregon · Washington · Guam · Northern Mariana Islands',
  '10th Circuit':'Colorado · Kansas · New Mexico · Oklahoma · Utah · Wyoming',
  '11th Circuit':'Alabama · Florida · Georgia',
  'Federal Circuit':'Nationwide subject-matter jurisdiction, including patents, federal claims, veterans and international trade'
};
function judicialDocs(){
  return state.documents.filter(d=>d.type==='Court Opinion'&&d.judicial&&d.judicial.administration===judicialState.administration&&(judicialState.circuit==='all'||d.judicial.circuit===judicialState.circuit));
}
function updateJudicialShelf(){
  const shelf=$('#judicial-vault');
  if(!shelf) return;
  shelf.hidden=state.filter!=='Court Opinion';
  if(!shelf.hidden) renderJudicialVault();
}
function renderJudicialVault(){
  const docs=judicialDocs();
  const circuitLabel=judicialState.circuit==='all'?'All courts':judicialState.circuit;
  $('#judicial-result-title').textContent=`${judicialState.administration} · ${circuitLabel}`;
  $('#judicial-case-count').textContent=`${docs.length} case${docs.length===1?'':'s'}`;
  const district=$('#district-directory');
  district.textContent=judicialState.circuit==='all'?'Select a circuit to see the appellate court and every federal district nested beneath it.':(districtMap[judicialState.circuit]||'Court directory ready for indexing.');
  $('#judicial-case-grid').innerHTML=docs.map(d=>{
    const j=d.judicial||{};
    return `<article class="judicial-case-card"><div class="judicial-case-top"><span>${j.circuit||'Federal Court'}</span><span>${d.id}</span></div><h3>${d.title}</h3><p>${d.summary}</p><div class="judicial-case-decision"><div><strong>Decision</strong>${j.decision||d.status||'See opinion'}</div><div><strong>Vote</strong>${j.vote||'See opinion'}</div></div><button class="open-case" type="button" data-case-id="${d.id}">Open case summary</button></article>`;
  }).join('');
  $('#judicial-empty').hidden=docs.length>0;
}
function openCase(id){
  const d=state.documents.find(x=>x.id===id); if(!d) return;
  const j=d.judicial||{};
  const path=(j.procedural_path||[]).map((x,i,a)=>`<span class="path-step">${x}</span>${i<a.length-1?'<span class="path-arrow">→</span>':''}`).join('');
  const filings=(j.filings||[]).filter(f=>f.url).map(f=>`<a href="${f.url}" target="_blank" rel="noopener">${f.label}</a>`).join('')||'<span>Filings are being indexed.</span>';
  $('#modal-content').innerHTML=`<div class="case-jacket"><p class="case-breadcrumb">Judicial Vault · ${j.administration||''} · ${j.circuit||''}</p><h2>${d.title}</h2><p class="case-subhead">${j.court||d.agency} · Docket ${j.docket||'See source'} · Decided ${fmtDate(d.date)}</p><div class="case-fast-grid"><div><strong>Decision</strong>${j.decision||d.status}</div><div><strong>Vote</strong>${j.vote||'See opinion'}</div><div><strong>Majority</strong>${j.majority||'See opinion'}</div><div><strong>Dissent</strong>${j.dissent||'See opinion'}</div></div><div class="case-section"><h3>What the Court decided</h3><p>${j.holding||d.summary}</p></div><div class="case-section"><h3>What the Court did not decide</h3><p>${j.not_decided||'Not yet indexed.'}</p></div><div class="case-section case-columns"><div class="case-column"><strong>Majority joined by</strong>${j.majority_joined||'See opinion'}</div><div class="case-column"><strong>Current status</strong>${d.status||'See docket'}</div></div><div class="case-section"><h3>Procedural path</h3><div class="procedural-path">${path||'<span class="path-step">Path being indexed</span>'}</div></div><div class="case-section"><h3>Case file</h3><div class="case-file-list">${filings}</div></div></div>`;
  modal.showModal();
}

document.addEventListener('click',e=>{
  const admin=e.target.closest('[data-judicial-admin]');
  if(admin){judicialState.administration=admin.dataset.judicialAdmin;document.querySelectorAll('[data-judicial-admin]').forEach(x=>x.classList.toggle('active',x===admin));renderJudicialVault();}
  const circuit=e.target.closest('[data-circuit]');
  if(circuit){judicialState.circuit=circuit.dataset.circuit;document.querySelectorAll('[data-circuit]').forEach(x=>x.classList.toggle('active',x===circuit));renderJudicialVault();}
  const caseButton=e.target.closest('[data-case-id]');
  if(caseButton) openCase(caseButton.dataset.caseId);
});
$('#judicial-reset')?.addEventListener('click',()=>{judicialState.circuit='all';document.querySelectorAll('[data-circuit]').forEach(x=>x.classList.toggle('active',x.dataset.circuit==='all'));renderJudicialVault()});

// Extend the existing renderer without changing the document index behavior.
const originalRender=render;
render=function(){originalRender();updateJudicialShelf();};
