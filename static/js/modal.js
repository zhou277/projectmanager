// projectmanager 3.21.0 — modal
// Classic script: shared globals preserve existing HTML event handlers.
function showModal(t,b,mode=""){
 const card=document.querySelector("#modal .modal-card");
 if(card){
   card.classList.remove("modal-large");
   if(mode==="large")card.classList.add("modal-large");
 }
 $("#modalTitle").textContent=t;
 $("#modalBody").innerHTML=b;
 $("#modal").classList.remove("hidden");
}

function closeModal(){
 $("#modal").classList.add("hidden");
 const card=document.querySelector("#modal .modal-card");
 if(card)card.classList.remove("modal-large");
}

function f(label,name,value="",type="text",wide=false){
 return `<div class="${wide?"wide":""}"><label>${label}</label><input id="f_${name}" type="${type}" value="${esc(value)}"></div>`
}

function ta(label,name,value=""){
 return `<div class="wide"><label>${label}</label><textarea id="f_${name}">${esc(value)}</textarea></div>`
}

function sf(label,name,opts,value=""){
 return `<div><label>${label}</label><select id="f_${name}">${opts.map(o=>`<option value="${esc(o)}" ${o===value?"selected":""}>${esc(o)}</option>`).join("")}</select></div>`
}

function buttons(fn){
 return `<div class="actions" style="justify-content:flex-end;margin-top:14px"><button onclick="closeModal()">取消</button><button class="primary" onclick="${fn}">保存</button></div>`
}

function vals(){
 let o={};
 document.querySelectorAll("#modalBody [id^=f_]").forEach(e=>o[e.id.slice(2)]=e.value);
 const singleVersion=document.querySelector('#modalBody #f_version_id');
 if(singleVersion){
   o.version_ids=singleVersion.value?[Number(singleVersion.value)]:[];
 }else{
   o.version_ids=[...document.querySelectorAll('#modalBody input[name=version_id]:checked')].map(x=>Number(x.value));
 }
 if(document.querySelector("#modalBody #dependencyChoices")){
   o.dependency_ids=[...document.querySelectorAll('#modalBody input[name=dependency_id]:checked')].map(input=>Number(input.value));
 }
 return o
}
